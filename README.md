# PM Compass

AI knowledge assistant for Product Managers. Connects to Google Drive, then answers natural-language questions with cited, grounded answers — combining semantic (vector) search over documents with text-to-SQL over your tabular data.

**Live:** https://product-compass-nu.vercel.app/


> This is **v2** — a dark-premium redesign (Vercel/Raycast aesthetic) with a text-to-SQL path added on top of the original RAG search.

## What it does

- **Natural-language document search** — Ask questions in plain English across your Google Drive (Docs, Sheets, Slides, PDFs). Answers cite the exact source document; says "I don't know" when the corpus doesn't cover it.
- **Structured-data Q&A (text-to-SQL)** — Analytical questions ("what was MRR in November?") route to generated SQL over materialized tables instead of vector search.

### RAG pipeline (search-documents)

```
Query
  → Query expansion (Claude Haiku, +2 variants)
  → Router (flag-gated, `ENABLE_SQL_ROUTER`): text-to-SQL, else vector (SQL failures fall back to vector)
  → Vector: OpenAI embed → pgvector cosine search (top 10, default threshold 0.5) → dedup by chunk / source doc
  → Synthesis (Claude Haiku, temp=0) → cited answer + source docs
```

Indexing chunks prose by paragraph boundary and tabular data by row (header preserved), embeds via OpenAI, and stores in pgvector with an HNSW index. Tabular files are additionally materialized into a `sheets` schema for the SQL path.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui (Radix) |
| State | React Context (auth) + React Query + React Hook Form + Zod |
| Backend | Supabase — PostgreSQL + Edge Functions (Deno) |
| Auth | Supabase Auth → Google OAuth 2.0 (readonly scopes) |
| Vector DB | pgvector — 1536-dim, HNSW index, cosine similarity |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | Claude Haiku (synthesis, query expansion, SQL gen) — model-agnostic via `LLM_PROVIDER` / `LLM_MODEL` (OpenRouter swap) |
| Integrations | Google Drive (read-only) |
| Hosting | Vercel (frontend) + Supabase Cloud (backend) |

## How to run

Prereqs: Node 18+, npm, Deno (for evals), Supabase CLI.

```bash
npm install        # install deps
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build → dist/
npm run lint       # ESLint
npm run test       # Vitest

# Deploy
vercel --prod                     # frontend
supabase functions deploy <name>  # one edge function
supabase db push --linked         # migrations

# Evals (Deno)
set -a && source .env.evals && set +a
deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```

### Environment variables

- **Frontend (`.env`):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- **Supabase secrets:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL` (Postgres URI; custom secrets cannot use the `SUPABASE_` prefix). Optional model swap: `LLM_PROVIDER`, `LLM_MODEL`, `OPENROUTER_API_KEY`.

## Project structure

```
src/
  pages/         Landing, Dashboard, Search, Settings, Onboarding, AuthCallback
  components/    layout/, search/, ui/ (PM-branded wrappers over shadcn)
  contexts/      AuthContext
  integrations/  Supabase client + generated types
  lib/           google-auth, utils

supabase/
  functions/     Edge Functions (Deno):
    store-oauth-tokens   save Google tokens after OAuth
    index-documents      Drive → chunk → embed → pgvector (+ materialize tabular → SQL)
    search-documents     query → route → vector / text-to-SQL → synthesis
    _shared/             LLM helper, pg-client
  migrations/    SQL schema (RLS scoped to auth.uid())

evals/           RAG eval framework (Deno harness)
  run-evals.ts          retrieval + answer-quality harness
  golden-dataset.json   50 queries across 7 categories, with ground truth
  sql-golden.json       text-to-SQL golden queries
  results/              timestamped eval output (gitignored)
```

## Status / notes

- **Deployed search config:** vector + query expansion. Hybrid (keyword + RRF) and Cohere reranking were tested but not shipped — reranking hurt domain relevance in every configuration. The `fts` column and `keyword_search` RPC remain in the schema but are not called by current code.
- **Eval (50-query golden set, as published in the app):** Recall@5 78.8%, Precision@5 63.4%, MRR 81.2%, Faithfulness 4.8/5, ~6s average response, ~11s P95 latency.
- **Test data:** a fictional SaaS company ("RavenStack") built from a public Kaggle churn dataset, date-shifted and expanded into 50 synthetic Drive documents via Google Apps Script (`evals/apps-script/`).
- All Drive scopes are read-only.
