# PM Compass v2 — Onboarding Guide

## What is this?

PM Compass is an AI-powered knowledge assistant for Product Managers. It connects to a user's Google Drive and provides:
1. **Natural language document search** — ask questions in plain English, get answers synthesized from your Google Drive docs
2. **Structured data Q&A (text-to-SQL)** — analytical questions over spreadsheets are answered with generated SQL

Think of it as "ChatGPT for your Google Drive, built for PMs."

For deeper detail see `docs/architecture.md` (system design), `docs/context.md` (file-level reference and "where to change things") and `CLAUDE.md` (guardrails and conventions).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| State | React Context (auth) + React Query (server data) |
| Backend | Supabase (PostgreSQL + Edge Functions in Deno) |
| Auth | Google OAuth 2.0 (3 readonly scopes) via Supabase Auth |
| Vector DB | pgvector extension (1536-dim embeddings, HNSW index) |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | Claude Haiku 4.5 (search synthesis, query expansion, text-to-SQL), swappable via `LLM_PROVIDER`/`LLM_MODEL` (OpenRouter) |
| Hosting | Vercel (frontend) + Supabase Cloud (backend) |

---

## Project Structure

```
src/
  pages/              → Landing, Onboarding, Dashboard, Search, Settings, AuthCallback
  components/
    layout/           → AppLayout, Sidebar, Navbar, PageTransition
    search/           → AnswerTrace, FeedbackModal, DocumentDetailPanel, TabularSnippet, CodeBlock
    ui/               → PM-branded wrappers over shadcn (PMButton, PMCard, PMBadge, etc.)
    CommandPalette.tsx → Cmd+K search
  contexts/           → AuthContext (user, session, loading, signOut)
  integrations/       → Supabase client + generated types
  lib/                → google-auth.ts, utils.ts
  hooks/              → use-mobile, use-toast

supabase/
  functions/          → 3 Edge Functions + _shared (Deno/TypeScript)
    store-oauth-tokens/   → Save Google tokens after OAuth
    index-documents/      → Drive → chunk → embed → pgvector (+ materialize tabular → SQL)
    search-documents/     → Query → route → vector search OR text-to-SQL → Claude synthesis
    _shared/              → anthropic.ts (LLM helper), pg-client.ts
  migrations/         → SQL migrations (tables, indexes, RPCs, sheets_reader role)

evals/                → Evaluation framework (Deno)
  run-evals.ts        → Retrieval + answer-quality harness
  run-sql-evals.ts    → Text-to-SQL harness (sql-golden.json)
  run-router-eval.ts  → Routing decision harness
  golden-dataset.json → 50 test queries with ground truth
  results/            → Timestamped eval output files (gitignored)
```

---

## How the App Works (User Journey)

### Step 1: Sign In
1. User clicks "Get Started with Google" on the landing page / onboarding wizard
2. Redirects to Google consent screen (3 readonly scopes: Drive metadata, Drive read, Docs read)
3. Google redirects back to `/auth/callback`
4. `AuthCallback` extracts the Google provider token and calls `store-oauth-tokens`
5. Token saved to `oauth_tokens` → user redirected to `/dashboard`

### Step 2: Index Documents
1. On first dashboard load (no chunks and no `pm-compass-indexed` flag), the app auto-triggers `index-documents`
2. The edge function fetches Drive files (up to 200) using the stored OAuth token, 3 files per call; the client loops using `offset` until `remaining` is 0
3. Per file: export text → chunk (prose: paragraph/sentence boundary; tabular: row boundary with header repeated) → OpenAI embeddings (batch 20) → store in `document_chunks`. Tabular files are also materialized into per-user SQL tables when `MATERIALIZE_SHEETS=true`
4. User can re-index anytime from Settings (this wipes all of the user's chunks)

### Step 3: Search
1. User types a query in the search bar or Command Palette (Cmd+K)
2. Frontend streams `search-documents` (SSE) with the query
3. Pipeline:
   - **SQL router (optional, flag-gated):** a single planner call picks `sql` / `hybrid` / `vector`. SQL is validated and run in a sandbox; any failure falls back to vector.
   - **Query expansion:** Claude Haiku generates 2 alternative phrasings
   - **Embedding:** all 3 variants embedded via OpenAI (in parallel)
   - **Vector search:** each embedding searches `document_chunks` via `match_documents` (default threshold 0.5, top 10 per variant)
   - **Dedup / context:** merge by chunk (highest similarity), cap 7 chunks / 6000 chars, up to 5 source docs
   - **Synthesis:** Claude Haiku (temp=0, 500 tokens) streams a grounded answer
4. Frontend shows the streaming answer, source cards, and an `AnswerTrace` panel for SQL/hybrid answers

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User metadata (display name, email, avatar). Auto-created on signup via trigger. |
| `oauth_tokens` | Google tokens. `UNIQUE(user_id, provider)`. Deleted on sign-out. |
| `document_chunks` | Indexed doc content + 1536-dim embeddings (and a generated `fts` column). |
| `sheet_registry` | Catalog of materialized SQL tables (column types, enum values, hashes, row count). |
| `sheets.*` | Per-user materialized tables (`u_<uid>_<slug>`), forced RLS, read via the `sheets_reader` role. |
| `prompt_templates` | Global versioned search prompts (synthesis v1–v4, expansion v1–v2). |
| `feedback` | User feedback on search quality (query + comment). |
| `search_trace` | Exists but is not written by current code. |

Key RPCs:
- `match_documents(query_embedding, match_count, match_threshold, user_uuid, theme_filter)` — pgvector cosine similarity search
- `keyword_search(...)` — full-text search (added for hybrid experiments; not called by current code)

All user tables have Row Level Security (RLS) scoped to `auth.uid() = user_id`.

---

## Design System

- **Dark-only theme** (no light mode toggle)
- **Glass effects**: `backdrop-blur` at 12px (`.glass`) and 24px (`.glass-strong`)
- **Glow accents**: `shadow-glow` on interactive elements
- **Gradient text**: `.text-gradient` (blue-to-purple)
- **Animations**: Framer Motion — page transitions, stagger on lists, skeleton shimmer loading, whileTap scale on buttons
- **Icons**: Lucide React exclusively
- **Components**: PM-branded wrappers (PMButton, PMCard, PMBadge) over shadcn/ui Radix primitives

---

## Edge Functions

| Function | When | Does |
|---|---|---|
| `store-oauth-tokens` | Once, after Google sign-in | Saves Google tokens to `oauth_tokens` |
| `index-documents` | Dashboard auto-index or Settings re-index | Drive → chunks → embeddings → `document_chunks` (+ SQL materialization) |
| `search-documents` | Every search | Route → vector or text-to-SQL → grounded synthesis (SSE or JSON) |

Supported Drive types: Google Docs, Sheets, Slides, PDFs, DOCX, XLSX, PPTX, TXT (binary formats are decoded crudely as UTF-8).

---

## Evals Framework

### Golden Dataset
50 test queries across 7 categories:

| Category | Tests | Example |
|----------|-------|---------|
| exact_lookup | Direct title/content match | "Find the 2025 product roadmap" |
| factual_extraction | Specific fact buried in a doc | "What's the churn rate for 3+ urgent tickets?" |
| tabular_statistical | Data from spreadsheets | "What was MRR in November 2024?" |
| paraphrase | Different words than the doc uses | "Revenue dashboard" (doc is "MRR & Subscription Dashboard") |
| cross_document | Answer needs 2-3 docs combined | "How do AI features affect churn?" |
| negative | Query about non-existent content | "What is our quantum computing strategy?" |
| vague_broad | Underspecified queries | "Strategy documents" |

### Metrics
| Metric | What it measures |
|--------|-----------------|
| Recall@5 | Did we find the right documents in the top 5? |
| Precision@5 | What fraction of top 5 results are actually relevant? |
| MRR | How high is the first relevant result ranked? |
| Factual Containment | Does the AI answer contain the expected facts? |
| Citation Accuracy | Are the sourced docs correct? |
| LLM-as-Judge | Claude rates answer quality 1-5 (optional) |

### Running Evals
```bash
set -a && source .env.evals && set +a
deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```

The `.env.evals` file needs: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EVAL_USER_EMAIL`, `ANTHROPIC_API_KEY`

---

## RAG Pipeline Experiments

Five experiments optimized the search pipeline:

| # | Config | Recall@5 | Precision@5 | MRR | Avg Latency |
|---|--------|----------|-------------|-----|-------------|
| 1 | Baseline (vector only) | 78.7% | 53.1% | 78.7% | 4,988ms |
| 2 | **+ Query expansion** | 78.7% | **57.6%** | **79.7%** | 5,027ms |
| 3 | + Hybrid search (keyword + RRF) | **79.5%** | 50.1% | 75.2% | 5,599ms |
| 4 | + Hybrid + Cohere rerank | 77.2% | 48.9% | 73.6% | 14,119ms |
| 5 | Vector + Cohere rerank (no hybrid) | 74.7% | 42.8% | 73.5% | 6,384ms |

**Deployed vector config: Experiment 2** (query expansion only).

Key learnings:
- **Query expansion** was the biggest win (+4.5pp precision, negligible latency)
- **Hybrid search** helped recall but hurt precision
- **Cohere reranking** hurt in every configuration
- **Remaining weak spots**: paraphrase queries (47% recall), vague/broad queries (47% recall)

### Leftover experiment infrastructure (not used by current code)
- `fts` tsvector column on `document_chunks` and GIN index `idx_document_chunks_fts`
- `keyword_search` RPC function

The Cohere rerank and RRF helper functions are no longer in `search-documents`.

---

## Local Development Setup

### Prerequisites
- Node.js 18+
- npm
- Deno (for evals)
- Supabase CLI

### Steps

```bash
# 1. From the project root
cd Product_Compass-main

# 2. Install dependencies
npm install

# 3. Create .env file (get values from Supabase dashboard)
# VITE_SUPABASE_URL=https://umxpfhudmrqcwpeuveuq.supabase.co
# VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
# VITE_SUPABASE_PROJECT_ID=umxpfhudmrqcwpeuveuq

# 4. Start dev server
npm run dev
# → Opens at http://localhost:5173
```

---

## Deploying Changes

```bash
# Frontend → Vercel
vercel --prod

# Edge functions → Supabase
supabase functions deploy <function-name> --project-ref umxpfhudmrqcwpeuveuq

# Database migrations → Supabase
supabase db push --linked
```

---

## External Services & Credentials

| Service | Purpose | Where configured |
|---------|---------|-----------------|
| **Supabase** | Database + Auth + Edge Functions | supabase.com/dashboard/project/umxpfhudmrqcwpeuveuq |
| **Vercel** | Frontend hosting | pmcompass.vercel.app |
| **Google Cloud Console** | OAuth client + API scopes | console.cloud.google.com |
| **OpenAI** | Embeddings (`text-embedding-3-small`) | Supabase secret: `OPENAI_API_KEY` |
| **Anthropic** | LLM (Claude Haiku 4.5) | Supabase secret: `ANTHROPIC_API_KEY` |
| **OpenRouter** (optional) | LLM swap | `LLM_PROVIDER`, `LLM_MODEL`, `OPENROUTER_API_KEY` |
| **Postgres (direct)** | Materialization and text-to-SQL | `DATABASE_URL` |

Feature-flag secrets (all default off): `ENABLE_SQL_ROUTER`, `ENABLE_HYBRID`, `SQL_USER_ALLOWLIST`, `MATERIALIZE_SHEETS`.

---

## Test Data

The eval dataset uses a fictional SaaS company called **RavenStack**, built from the [SaaS Subscription & Churn Analytics Dataset](https://www.kaggle.com/datasets/rivalytics/saas-subscription-and-churn-analytics-dataset) on Kaggle. The raw CSVs were date-shifted +1 year and used to generate 50 synthetic Google Drive documents (board decks, PRDs, meeting notes, spreadsheets, research reports, etc.) via Google Apps Script (`setup.gs` + `batch1-6.gs`).

---

## Key Commands Reference

```bash
npm run dev                    # Vite dev server (localhost:5173)
npm run build                  # Production build → dist/
npm run lint                   # ESLint
npm run test                   # Vitest

# Deploy
vercel --prod                  # Frontend to Vercel
supabase functions deploy <name> --project-ref umxpfhudmrqcwpeuveuq  # Edge function
supabase db push --linked      # Database migration

# Evals
set -a && source .env.evals && set +a
EVAL_RUN_NAME=my-test deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```
