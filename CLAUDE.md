# PM Compass v2 — Dark Premium Redesign

**This is a separate fork** of PM Compass with a dark premium aesthetic (Vercel/Raycast style). Do not modify the original project from this copy.

## What This Product Does

AI-powered knowledge assistant for Product Managers. Connects to Google Drive and provides:

1. **Natural language document search** — Semantic search across Google Drive with AI-synthesized answers
2. **Structured data Q&A** — Text-to-SQL over tabular data (spreadsheets) for analytical questions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix primitives) |
| State | React Context (auth) + React Query (server data) + React Hook Form + Zod |
| Backend | Supabase (PostgreSQL + Edge Functions in Deno) |
| Auth | Supabase Auth → Google OAuth 2.0 (3 readonly scopes) |
| Vector DB | pgvector (1536-dim, HNSW index, cosine similarity) |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | Claude Haiku 4.5 (search synthesis, text-to-SQL) — model-agnostic via `LLM_PROVIDER`/`LLM_MODEL` (OpenRouter swap) |
| Integrations | Google Drive (read-only) |
| Hosting | Vercel (frontend) + Supabase Cloud (backend) |

## Project Structure

```
src/
  pages/          → Landing, Dashboard, Search, Settings, Onboarding, AuthCallback
  components/     → layout/, search/, ui/ (PM-branded wrappers over shadcn)
  contexts/       → AuthContext (user, session, loading, signOut)
  integrations/   → Supabase client + generated types
  lib/            → google-auth.ts, utils.ts (cn, getUserDisplayName)
  hooks/          → use-mobile, use-toast

supabase/
  functions/      → Edge Functions (Deno/TypeScript):
    store-oauth-tokens/   → Save Google tokens after OAuth
    index-documents/      → Drive → chunk → embed → pgvector (+ materialize tabular → SQL)
    search-documents/     → Query → route → vector search OR text-to-SQL → Claude synthesis
                            (index.ts, sql-path.ts, route-and-generate.ts, sql-executor.ts, synthesis.ts, registry.ts;
                             router.ts + sql-generator.ts are legacy/unused, superseded by route-and-generate.ts)
    _shared/              → anthropic.ts (LLM helper), pg-client.ts
  migrations/     → SQL schema migrations

evals/            → RAG evaluation framework
  run-evals.ts    → Eval harness (Deno) — measures recall, precision, MRR, factual containment
  golden-dataset.json → Test queries with ground truth doc IDs
  run-sql-evals.ts + sql-golden.json → Text-to-SQL correctness
  run-router-eval.ts → Routing decisions (sql / vector / hybrid)
  results/        → Timestamped eval output (gitignored)
```

## Database Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | User metadata | user_id, display_name, email, avatar_url |
| `oauth_tokens` | Google tokens | user_id, provider, access_token, refresh_token, expires_at, scopes — **UNIQUE(user_id, provider)** |
| `document_chunks` | Indexed docs + embeddings | user_id, document_id, document_title, document_type, chunk_text, embedding(1536), metadata(jsonb) |
| `sheet_registry` | Text-to-SQL registry of materialized tables | user_id, table_name, columns(jsonb — type + enum value-hints) |
| `feedback` | User search feedback | user_id, query, feedback_text |
| `prompt_templates` | Global versioned prompts (search_synthesis v1–v4, query_expansion v1–v2); not user-scoped | slug, version, is_active, system_prompt, user_prompt_template |

**Key RPC:** `match_documents(query_embedding, match_count, match_threshold, user_uuid)` — pgvector cosine similarity search. (`keyword_search` RPC and the `search_trace` table exist in the schema but are not used by current code.)

All tables have RLS policies scoped to `auth.uid() = user_id`. Materialized text-to-SQL tables live in the `sheets` schema (e.g. `sheets.u_<uid>_<slug>`), also RLS-scoped.

## RAG Pipeline

### Indexing (index-documents)
Drive files → export text/CSV → chunk (prose: paragraph → sentence boundary, function default 800/200 overlap — the Settings "balanced" preset sends 1600/400, Dashboard auto-index uses 800/200; tabular: row-boundary with header repeated) → OpenAI embed (batch 20, max 200 chunks/doc, 3 files per call with client-driven `offset` pagination) → upsert document_chunks. Note: `offset=0` deletes ALL the user's chunks.

### Search (search-documents)
Query → (optional SQL router: `ENABLE_SQL_ROUTER` + `sheet_registry` rows → single planner call `route-and-generate.ts` → sql/hybrid, else fall back to vector) → vector path: query expansion (2 variants) → OpenAI embed → match_documents RPC per variant (top 10, default threshold **0.5**) → dedup by chunk, cap 7 chunks / 6000 chars, ≤5 source docs → Claude Haiku synthesis (temp=0, 500 tokens, SSE streaming with JSON fallback). Synthesis/expansion prompts come from the `prompt_templates` table (fallback hardcoded). Backend feature flags (all default OFF): `ENABLE_SQL_ROUTER`, `ENABLE_HYBRID`, `SQL_USER_ALLOWLIST`, `MATERIALIZE_SHEETS`.

### Text-to-SQL safety
LLM SQL is validated by an AST allowlist (single SELECT, registry tables only, blocked functions), LIMIT-clamped to 1000 rows, and run in a read-only transaction with 5s statement timeout, `search_path=sheets`, and `SET LOCAL ROLE sheets_reader` (forced per-table RLS). Any failure falls back to vector search.

## Routes

| Path | Page | Auth |
|------|------|------|
| `/` | Landing | Public |
| `/onboarding` | Onboarding | Public |
| `/auth/callback` | AuthCallback | Public |
| `/dashboard` | Dashboard | Protected |
| `/search?q=...` | Search | Protected |
| `/settings` | Settings | Protected |

## Google OAuth Scopes (all readonly)
`drive.metadata.readonly`, `drive.readonly`, `documents.readonly`

## Environment Variables

**Frontend (.env):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`

**Supabase Secrets:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL` (Postgres URI for materialize/text-to-SQL; cannot be named `SUPABASE_*`). Optional model swap: `LLM_PROVIDER`, `LLM_MODEL`, `OPENROUTER_API_KEY`.

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # Production build → dist/
npm run test          # Vitest
npm run lint          # ESLint

# Deploy frontend
vercel --prod                         # Deploy to pmcompass.vercel.app

# Edge functions
supabase functions serve              # Local dev
supabase functions deploy <name>      # Deploy one function

# Evals
deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```

## Conventions

- **Semicolons**: Yes. **Indentation**: 2 spaces.
- **Naming**: camelCase (vars/functions), PascalCase (components/types), SCREAMING_SNAKE (constants)
- **Components**: Functional + hooks only. PM-themed wrappers (PMButton, PMCard, PMBadge) over shadcn-ui base.
- **API calls**: `supabase.functions.invoke("name", { body })` for edge functions
- **Error UX**: try-catch + `toast.error()` for user-facing errors
- **Animations**: Framer Motion for page transitions
- **Icons**: Lucide React exclusively

## External References

- **Supabase project**: umxpfhudmrqcwpeuveuq
- **Production**: https://pmcompass.vercel.app

## Guardrails

- Do NOT change Google OAuth scopes without discussion (readonly by design)
- Do NOT use `supabase.auth.admin` from frontend code
- Do NOT add npm dependencies without stating why the existing stack can't handle it
- Do NOT use class components — hooks-only codebase
- Do NOT commit .env files or API keys

## Known Gotchas (verified against code)

- `supabase/config.toml` is stale: lists removed `sync-calendar`/`prepare-meeting`.
- `store-oauth-tokens` stores the scopes Google actually granted (calendar scopes dropped) and sets `expires_at` from tokeninfo `exp` / `expires_in`.
- Sign-out deletes all of the user's `oauth_tokens` rows. Settings "Delete account" calls `delete-account`, which drops `sheets.u_*` tables, deletes `search_trace`, and deletes the auth user (cascading `profiles`, `oauth_tokens`, `document_chunks`, `sheet_registry`, and `feedback`).
- Binary files (PDF/Office) are decoded as raw UTF-8, so quality is poor.
- The planner prompt in `route-and-generate.ts` is tuned to the Ravenstack sample dataset.
- Meetings/calendar features were removed (`drop_meetings_table` migration).
