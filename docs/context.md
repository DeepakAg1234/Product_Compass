# PM Compass v2 — Codebase Context

Working reference for making changes. It describes the structure, the end-to-end flows, and where to edit for common changes. It is based on the code, so where `CLAUDE.md` and the code disagree, see [Known discrepancies](#10-known-discrepancies--gotchas).

Guardrails and conventions live in `CLAUDE.md` (readonly Google scopes, no new npm deps without justification, hooks-only, semicolons, 2-space indent).

---

## 1. What it is

An AI knowledge assistant for PMs. Two capabilities:

1. **Document search.** Google Drive files are chunked and embedded into pgvector. A query is answered by Claude using the top chunks.
2. **Text-to-SQL.** Tabular data (Sheets/CSV) is mirrored into per-user Postgres tables. Analytical questions ("what was MRR in November?") are answered by generated SQL.

**Stack:** React 18 + TS + Vite + Tailwind + shadcn/Radix, React Query, Framer Motion, Lucide, Sonner. The backend is Supabase (Postgres + pgvector, Deno Edge Functions). Auth is Supabase Google OAuth. Embeddings use OpenAI `text-embedding-3-small`. The LLM is Claude Haiku 4.5 through `_shared/anthropic.ts`, swappable to OpenRouter. Frontend hosting is Vercel (SPA rewrite in `vercel.json`).

---

## 2. Repository map

```
src/
  main.tsx, App.tsx           Providers (QueryClient, AuthProvider, Tooltip, Toasters) + routes
  pages/
    Landing.tsx               Public marketing page (LandingOriginal.tsx = old version, Index.tsx = stub)
    Onboarding.tsx            3-step wizard -> signInWithGoogle
    AuthCallback.tsx          Post-Google-OAuth: stores provider token, -> /dashboard
    Dashboard.tsx             Greeting, auto-index on first login, recent searches
    Search.tsx                Streams search-documents (SSE), renders answer + sources
    Settings.tsx              Connections, re-index, chunk presets, delete data
    NotFound.tsx
  components/
    layout/                   AppLayout (sidebar + Cmd+K palette), Sidebar, Navbar, PageTransition
    search/                   AnswerTrace (SQL trace UI), DocumentDetailPanel, FeedbackModal,
                              TabularSnippet, CodeBlock
    ui/                       shadcn primitives + PM wrappers (pm-button/card/badge/input/modal/
                              search-bar/tabs/tooltip/avatar), stagger-children, skeleton-shimmer
    CommandPalette.tsx        Cmd+K search box; saves recent searches; navigates to /search?q=
    ProtectedRoute / PublicRoute / NavLink
  contexts/AuthContext.tsx    user, session, loading, signOut
  integrations/supabase/      client.ts (exports supabase, SUPABASE_URL, SUPABASE_ANON_KEY), types.ts
  lib/                        google-auth.ts, utils.ts (cn, getUserDisplayName)
  hooks/                      use-mobile, use-toast

supabase/
  config.toml                 project_id, localhost auth site_url, per-function verify_jwt
  migrations/                 Schema history (see section 7)
  functions/
    store-oauth-tokens/       Save Google provider tokens (expiry from tokeninfo)
    delete-account/           Drop sheets tables, delete search_trace, delete auth user
    index-documents/          Drive -> chunk -> embed -> document_chunks (+ materialize CSV -> SQL)
      materialize-sql.ts      CSV parse, type inference, CREATE TABLE + RLS + registry upsert
    search-documents/         Router/orchestrator for search (vector, SQL, hybrid)
      index.ts                Entry; prompts, query expansion, vector path, SSE
      sql-path.ts             SQL/hybrid orchestration
      route-and-generate.ts   One Haiku call: choose mode + write SQL
      sql-executor.ts         AST validation + sandboxed execution
      synthesis.ts            SQL rows -> natural-language answer
      registry.ts             sheet_registry rows -> schema prompt text
      router.ts, sql-generator.ts   Legacy two-call router/generator; not imported anywhere, superseded by route-and-generate.ts
    _shared/
      anthropic.ts            callClaude, callClaudeStream, parseJsonLoose, HAIKU/SONNET consts
      pg-client.ts            Direct Postgres client (DATABASE_URL) for DDL/SQL

evals/                        RAG/SQL/router eval harnesses + golden datasets (Deno)
scripts/                      Seeding and dev scripts (materialize-ravenstack, test-sql-path)
docs/                         This file
```

---

## 3. Frontend architecture

### Routing (`src/App.tsx`)

| Path | Component | Guard |
|---|---|---|
| `/` | Landing | `PublicRoute` (redirects logged-in users) |
| `/onboarding`, `/auth/callback` | Onboarding, AuthCallback | none |
| `/dashboard`, `/search`, `/settings` | pages | `ProtectedRoute` + `AppLayout` |
| `*` | NotFound | none |

Add new routes above the catch-all. Sidebar nav items live in the `navItems` array in `components/layout/Sidebar.tsx`. The "Search" item opens the command palette instead of navigating.

### Auth

- `signInWithGoogle()` in `lib/google-auth.ts` calls `supabase.auth.signInWithOAuth` with `redirectTo=/auth/callback`, the 3 readonly Drive/Docs scopes, `access_type=offline` and `prompt=consent`.
- `AuthCallback` reads `session.provider_token` and `provider_refresh_token`, then calls `store-oauth-tokens`. The provider token is only available right after sign-in. The function sets `expires_at` from Google tokeninfo. After storing, it navigates to `/dashboard`.
- `AuthContext.signOut()` deletes the user's `oauth_tokens` rows (to force re-consent next time), signs out, and clears the localStorage keys `pm-compass-indexed` and `pm-compass-recent-searches`.

### Key page behavior

- **Dashboard.** Polls `oauth_tokens` for a Google row (3 retries, to cover the post-OAuth race). If the localStorage flag `pm-compass-indexed` is missing and `document_chunks` is empty, it auto-runs `index-documents` in a loop (`offset` pagination, driven by `status`/`remaining`).
- **Search.** Reads `?q=`. `streamSearch()` does a raw `fetch` to `/functions/v1/search-documents` with `{query, stream:true}` and parses SSE events:
  - `step` updates the pipeline loader. `STEP_LABELS` maps step ids to text.
  - `token` appends to the growing answer.
  - `result` carries `{answer, sources, query, trace?}`.
  - `error` throws.
  - On any stream failure it falls back to `supabase.functions.invoke("search-documents", {body:{query}})`.
  - `trace.mode !== "vector"` shows "computed from your data" and the `AnswerTrace` panel.
  - "Summarize" per document is just another search: `"Summarize the key points of <title>"`.
- **Settings.**
  - Re-index loops `index-documents` with chunk params from the preset (precise 800/200, balanced 1600/400, context-rich 3200/800, custom). The choice is stored in localStorage `pm-compass-chunk-settings`.
  - Disconnect for Google deletes the `oauth_tokens` row for provider `google`.
  - Chunk/file counts are read directly from `document_chunks`.
  - Delete account calls `delete-account`, which drops `sheets.u_*` tables, deletes `search_trace`, and deletes the auth user.

Conventions: PM wrappers (`PMButton` etc.), `glass` utility classes, Framer Motion `StaggerContainer`/`StaggerItem`, `toast` from `sonner`.

---

## 4. Backend flows

Every user-facing function builds a user-scoped Supabase client from the `Authorization` header and calls `auth.getUser()`. Writes use a service-role client. All use `Deno.serve` with the same CORS headers.

### 4.1 Indexing — `index-documents`

1. Auth, then load the Google token from `oauth_tokens` (user client, RLS). If it expires within 60s, refresh via Google's token endpoint and update the row (service client).
2. If `offset === 0`, **delete ALL of the user's `document_chunks`**. See gotchas.
3. List Drive files (up to 200, modified desc) filtered to the MIME allowlist: Google Doc/Sheet/Slides, PDF, docx/xlsx/pptx, text.
4. Process `files.slice(offset, offset + BATCH_SIZE)` where `BATCH_SIZE = 3`. The response is `{processed, remaining, total, status: "in_progress"|"complete"}` and the client loops.
5. Per file:
   - Fetch content. Google files are exported as text/CSV. Binary Office/PDF files are decoded as UTF-8 and stripped of control characters (crude; no real parser).
   - Truncate to 200k chars.
   - `chunkText()`:
     - **Tabular** is detected when ≥70% of the first 20 lines have a consistent comma count. Chunks split on row boundaries, repeat the header in every chunk, and record `account_ids` per chunk (from an `account_id` column).
     - **Prose** is split paragraph, then sentence, then hard split, packed to `chunkSize` with overlap. Each chunk gets the nearest preceding `heading`. Every chunk is prefixed `Document: <title>`.
   - Cap at 200 chunks per doc. Embed in batches of 20.
   - Delete the doc's old chunks and insert new rows with `metadata {source:"google_drive", content_type, account_ids?, heading?}`.
   - If `MATERIALIZE_SHEETS=true` and the doc is tabular, call `materializeCsvAsTable()` (isolated try/catch so failures never break vector indexing).
6. Constants at the top of `index-documents/index.ts`: `CHUNK_SIZE=800`, `CHUNK_OVERLAP=200`, `BATCH_SIZE`, `MAX_CHUNKS_PER_DOC`, `MAX_CONTENT_CHARS`, `EMBEDDING_BATCH_SIZE`. The client can override size and overlap via the request body. The Settings default sends 1600/400.

### 4.2 Materialization (text-to-SQL storage) — `index-documents/materialize-sql.ts`

`materializeCsvAsTable(sql, userId, {id,title}, csv, sheetName)` does the following in one transaction:

1. `parseCsv` (RFC4180) and `sanitizeHeaders` (lowercase, snake_case, unique).
2. `inferType` per column over all rows: bool (True/False only), int4/int8, numeric (any decimal or >50% null), date, timestamp, else text. Empty strings become NULL.
3. Table name `sheets.u_<uid-hex>_<slug>`, clamped to 63 bytes.
4. `DROP TABLE IF EXISTS … CASCADE`, then `CREATE TABLE`, then batched `INSERT` (1000 rows).
5. `buildRlsBlock`: enable and force RLS, policy `rls_user` for role `sheets_reader` where `current_setting('request.user_id', true) = '<uid>'`, plus `GRANT SELECT`.
6. Upsert `public.sheet_registry` with `columns` jsonb: `{name, type, nullable, sample_values, enum?}`. Columns with ≤25 distinct values store the full set as `enum: true`. Others store 3 samples.

The registry is what the SQL planner sees (`registry.ts` → `buildSchemaPrompt`, which lists "one of: …" for enums).

### 4.3 Search — `search-documents`

Body: `{query, threshold?, prompt_version?, qe_version?, stream?}`. Default `threshold` is **0.5**.

Two response modes with the same logic:
- `stream:true` → SSE (`step`/`token`/`result`/`error`).
- Otherwise → one JSON `{answer, sources, query, trace?}`.

Flow:

```
query
 ├─ [flag ENABLE_SQL_ROUTER && user allowed] → runSqlPath()
 │     returns result  → done
 │     returns null    → fall through to vector
 └─ vector path:
      getPrompt(search_synthesis), getPrompt(query_expansion)   (DB prompt_templates, with hardcoded fallback)
      expandQuery()  -> [query, ...2 variants]   (Haiku, JSON array)
      embed all variants (OpenAI)
      match_documents RPC per embedding (top 10, threshold)
      assembleVectorResult(): dedup by chunk id (max similarity), sort, cap 7 chunks / 6000 chars,
                              build context + `sources` (max 5 distinct docs)
      Claude synthesis (callClaude / callClaudeStream)   -> answer
```

`assembleVectorResult` is shared by the JSON and SSE paths. Keep them in sync by editing that function rather than the callers.

The SQL path (`sql-path.ts`):

1. Return `null` if the user has no `sheet_registry` rows.
2. `routeAndGenerate()` is one Haiku call returning `{mode: sql|hybrid|vector, sql, tables_used, reason, confidence}`. The system prompt (in `route-and-generate.ts`) has dataset-specific gotchas for the Ravenstack sample data (boolean columns, NULL `end_date` = active, and so on). The planner fails to `vector` on any error.
3. Fall back to vector (return `null`) if mode is `vector`, if mode is `hybrid` while `ENABLE_HYBRID` is off, or if no SQL was produced.
4. `runSql()` in `sql-executor.ts`. Defense in depth:
   - AST parse with `pgsql-ast-parser`: exactly one statement, SELECT or WITH…SELECT only, tables must be in the user's registry (or CTE names), no foreign schemas, and blocked functions (`pg_sleep`, `dblink`, `set_config`, …).
   - `LIMIT 1000` injected or clamped in the AST.
   - Executed in a READ ONLY transaction with a 5s statement timeout, `search_path=sheets`, `request.user_id` GUC set, and `SET LOCAL ROLE sheets_reader` last, so RLS applies.
   - It never throws. Errors cause a fallback to vector.
5. Synthesis (`synthesis.ts`):
   - SQL mode: answer only from rows (first 20 rendered as a markdown table).
   - Hybrid mode: SQL rows plus feedback chunks whose `metadata.account_ids` intersect the `account_id` values in the SQL rows (top 7). It degrades to a SQL-only summary if no chunks match.
6. Returns `{answer, sources: [], query, trace}`. Trace fields: mode, reason, confidence, sql, tables, row_count, truncated, model, exec_ms, evidence_chunks.

**Feature flags (Supabase secrets):** `ENABLE_SQL_ROUTER` (default off), `ENABLE_HYBRID` (default off), `SQL_USER_ALLOWLIST` (CSV of user ids; empty means everyone), and in `index-documents`, `MATERIALIZE_SHEETS`. With these off, search is vector-only.

### 4.4 LLM helper — `_shared/anthropic.ts`

- `callClaude(opts)` and `callClaudeStream(opts, onDelta)` use raw `fetch` (no SDK). `HAIKU="claude-haiku-4-5-20251001"`, `SONNET="claude-sonnet-4-6"`.
- Provider swap: `LLM_PROVIDER=openrouter` makes every call use OpenRouter (`OPENROUTER_API_KEY`). `LLM_MODEL` overrides the per-call model on both providers (on OpenRouter it must be a real slug).
- `parseJsonLoose<T>` tolerates code fences and trailing prose.
- **All new LLM calls should go through this helper** to keep the swap working.

### 4.5 Other functions

- `store-oauth-tokens`: upserts the Google row `(user_id, provider='google')`. `expires_at` and `scopes` come from Google tokeninfo. Calendar scopes are dropped.
- `delete-account`: drops owned `sheets` tables via `DATABASE_URL`, deletes `search_trace`, then `auth.admin.deleteUser` (cascades profile, tokens, chunks, registry, feedback).

---

## 5. End-to-end flows (summary)

**First-time login**
`Landing/Onboarding` → `signInWithGoogle` → Google consent → `/auth/callback` → `store-oauth-tokens` → `/dashboard` → (no chunks and no flag) → `index-documents` loop → searchable.

**Search**
`Cmd+K` / Dashboard / URL → `/search?q=` → SSE `search-documents` → (SQL path or vector path) → answer tokens + sources → UI (`AnswerTrace` for SQL).

---

## 6. Data model

| Table / object | Purpose |
|---|---|
| `profiles` | User metadata. |
| `oauth_tokens` | Google tokens. `UNIQUE(user_id, provider)`. |
| `document_chunks` | `user_id, document_id, document_title, document_type, document_owner, document_url, chunk_index, chunk_text, embedding vector(1536), metadata jsonb`, plus a generated `fts` tsvector. Document types: `doc/sheet/slide/pdf`. |
| `sheet_registry` | Catalog of materialized tables (columns jsonb, hashes, row_count, `sql_enabled`). RLS: owner select, service_role all. |
| `sheets.*` | Per-user materialized tables (`u_<uid>_<slug>`). Forced RLS, readable only by `sheets_reader` when the GUC matches. |
| `prompt_templates` | Versioned prompts (`search_synthesis` v1–v4, `query_expansion` v1–v2). One `is_active` per slug. Selectable per request via `prompt_version`/`qe_version`. |
| `feedback` | "Can't find what you need?" submissions. |
| `search_trace` | Table exists, **not written by current code**. |
| RPC `match_documents(query_embedding, match_count, match_threshold, user_uuid)` | Cosine similarity search (HNSW). |
| RPC `keyword_search(...)` | Full-text search over `fts`. **Not used by current code.** |
| RPC `execute_sheet_sql` | Defined in migrations. Execution now happens in `sql-executor.ts` via a direct pg client. |

All public tables use RLS scoped to `auth.uid() = user_id`.

## 7. Migrations (chronological)

Initial schema (Feb 2026, 5 files), `fix_match_documents_search_path`, `create_feedback_table`, `add_hybrid_search` (fts + keyword_search), `prompt_registry` (templates and seeds), `sheet_registry`, `sheets_reader` (role and execute function), `search_trace`, `security_advisor_fixes`, `fix_execute_sheet_sql_regex`, `oauth_tokens_per_provider`, `drop_meetings_table`.

Add new migrations as `supabase/migrations/<timestamp>_<name>.sql`. Do not edit old ones.

---

## 8. Configuration

**Frontend `.env`:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.

**Supabase secrets:**
- Core: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`.
- Feature flags: `ENABLE_SQL_ROUTER`, `ENABLE_HYBRID`, `SQL_USER_ALLOWLIST`, `MATERIALIZE_SHEETS`.
- Model swap: `LLM_PROVIDER`, `LLM_MODEL`, `OPENROUTER_API_KEY`.

**Commands:** `npm run dev | build | test | lint`; `supabase functions deploy <name>`; `vercel --prod`.

**Evals** (`evals/`, Deno): `run-evals.ts` (retrieval recall/precision/MRR/factual containment/LLM judge), `run-sql-evals.ts` + `sql-golden.json`, `run-router-eval.ts`, plus `reindex.ts` and the Apps Script data generators. Run after changing chunking, thresholds, prompts or the router.

---

## 9. Where to change things

| I want to… | Edit |
|---|---|
| Change chunk size, overlap or splitting | `index-documents/index.ts` constants and `chunkProse`/`chunkTabular`. Also Settings presets (`getChunkParams`), which override the defaults. Re-index is required. |
| Support a new file type | `DRIVE_MIME_TYPES`, `getMimeExport`, `getDocType`, `getDocUrl`, and `mapDocumentType` in `Search.tsx`. |
| Tune retrieval (threshold, top-k, context size) | `search-documents/index.ts`: `matchThreshold` default 0.5, `match_count`, and `MAX_LLM_CHUNKS`/`MAX_CONTEXT_CHARS` in `assembleVectorResult`. |
| Change the answer style or prompts | The `prompt_templates` table (new version, set `is_active`). `FALLBACK_PROMPTS` in `search-documents/index.ts` is the code fallback. SQL/hybrid prompts are inline in `synthesis.ts`. |
| Change the SQL planner behavior | `route-and-generate.ts` `SYSTEM` prompt. Dataset-specific gotchas live there. |
| Loosen or tighten SQL safety | `sql-executor.ts` (`BLOCKED_FUNCTIONS`, `MAX_ROWS`, timeouts) and the RLS block in `materialize-sql.ts`. |
| Add a search pipeline step to the UI | `send("step", …)` in the backend and `STEP_LABELS` in `Search.tsx`. |
| Switch the LLM model or provider | Secrets `LLM_PROVIDER`/`LLM_MODEL` (no code). Default model constants are in `_shared/anthropic.ts`. |
| Add a new integration (e.g. Notion) | Add an OAuth function, a sync function writing to `document_chunks` (+ optionally `materializeCsvAsTable`), a Settings card, and a distinct `provider` row in `oauth_tokens`. |
| Add a page | Create it in `src/pages`, add the route in `App.tsx` (above `*`), and add a `navItems` entry in `Sidebar.tsx`. |
| Restyle | `index.css`, `tailwind.config.ts`, and the `pm-*` wrappers in `components/ui`. |

---

## 10. Known discrepancies & gotchas

- **Chunk size mismatch.** `CLAUDE.md` says 1600/400. The function default is 800/200, but the Settings UI default preset ("balanced") sends 1600/400, so real indexing usually uses 1600/400. Dashboard auto-indexing sends no params, so it uses 800/200.
- **Search threshold.** The default is 0.5, while `CLAUDE.md` says 0.3. The hybrid vector helper uses 0.2.
- **`supabase/config.toml` Site URL is localhost.** Production Auth redirect URLs are set in the dashboard. Do not `supabase config push` this file over them.
- **Sign-out and disconnect delete `oauth_tokens`.** This forces re-consent.
- **Delete Account** calls `delete-account`. It needs `DATABASE_URL` when the user has materialized sheet tables.
- **Dead or unused code.** `search_trace` table, `keyword_search` RPC, `LandingOriginal.tsx`, `Index.tsx`, and the `routing` step label in `Search.tsx`. Meetings and calendar were removed.
- **`route-and-generate.ts` prompt is dataset-specific** (Ravenstack: `accounts`, `churn_events`, …). It may need generalizing for other data.
- **Binary file parsing** (PDF, docx, xlsx, pptx) is raw UTF-8 decoding. Quality is poor, and files with <50 readable chars are skipped.
- **Feature flags default OFF** in the backend. If SQL answers aren't appearing, check `ENABLE_SQL_ROUTER` and `MATERIALIZE_SHEETS` first, then confirm `sheet_registry` has rows for the user.
- **Shell/OS note:** the dev machine is Windows/PowerShell. Use PowerShell syntax for commands.
