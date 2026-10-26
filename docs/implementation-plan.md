# PM Compass v2 — Implementation Plan

Derived from [`architecture.md`](./architecture.md). Section 1 lists what is already built. Section 2 lists what remains, taken from the architecture's "Known limitations and tech debt" (§14) and "Extension points" (§15).

Status key: `[x]` done, `[ ]` not started.

---

## Section 1 — Already Implemented

### 1.1 Platform and foundation
- [x] React 18 + TypeScript + Vite + Tailwind + shadcn/Radix SPA, hosted on Vercel (SPA rewrite in `vercel.json`)
- [x] Supabase-only backend: Postgres + pgvector + Deno Edge Functions (no app server)
- [x] Dark premium design system: `PM*` wrappers, glass utilities, Framer Motion transitions, Lucide icons
- [x] Frontend shell: `App.tsx` providers, `ProtectedRoute` → `AppLayout`, Sidebar, Cmd+K `CommandPalette`
- [x] Pages: Landing, Onboarding, AuthCallback, Dashboard, Search, Settings
- [x] Local persistence (recent searches, indexed flag, chunk settings, sidebar state)

### 1.2 Authentication and credentials
- [x] Google sign-in via Supabase Auth with 3 readonly scopes (`access_type=offline`, `prompt=consent`)
- [x] `store-oauth-tokens` persists the Google provider token right after sign-in
- [x] Lazy server-side Google token refresh in `index-documents` (refresh if expiring within 60s)
- [x] `oauth_tokens` with `UNIQUE(user_id, provider)`

### 1.3 Ingestion
- [x] Drive indexing: file listing (≤200, MIME allowlist), content export, 200k char truncation
- [x] Client-driven batch pagination (3 files per call, `offset`/`remaining`), clean-slate delete on `offset=0`
- [x] Prose chunking (paragraph → sentence → hard split, overlap, heading tag)
- [x] Tabular detection and row-boundary chunking with repeated header and `account_ids` metadata
- [x] OpenAI embeddings (`text-embedding-3-small`, batches of 20, 200-chunk cap) into `document_chunks`
- [x] CSV → typed Postgres table materialization (`parseCsv`, type inference, single transaction, batched inserts, forced RLS, `sheet_registry` with enum value sets)
- [x] SQL materialization isolated from vector indexing (separate try/catch)

### 1.4 Query pipeline
- [x] `search-documents` with SSE streaming (`step`, `token`, `result`, `error`) and buffered JSON fallback
- [x] Query expansion (2 variants, fails soft) and multi-query retrieval via `match_documents`
- [x] Shared `assembleVectorResult()` (dedup, sort, 7 chunks / 6000 chars, ≤5 source docs)
- [x] Grounded synthesis (temp 0, 25s timeout) and fixed empty-retrieval message
- [x] Single-call planner (`route-and-generate.ts`) returning mode + SQL (`sql` / `hybrid` / `vector`)
- [x] Always-fallback-to-vector on any SQL-side failure
- [x] Hybrid synthesis: SQL rows as numbers plus verbatim feedback evidence matched by `account_ids`

### 1.5 Text-to-SQL safety
- [x] Layer 1: `sheets_reader` role + per-table forced RLS on `request.user_id`
- [x] Layer 2: AST allowlist (`pgsql-ast-parser`): single SELECT, registry tables only, no foreign schemas, blocked functions
- [x] Layer 3: statement timeout 5s, lock timeout 1s
- [x] Layer 4: AST LIMIT rewrite (≤1000 rows)
- [x] Layer 5: `search_path = sheets`
- [x] UUID validation on the inlined `userId`

### 1.6 LLM abstraction and prompts
- [x] `_shared/anthropic.ts` (`callClaude`, `callClaudeStream`) with Anthropic and OpenRouter providers, `LLM_PROVIDER`/`LLM_MODEL` swap
- [x] `AbortController` timeouts and `parseJsonLoose`
- [x] `prompt_templates` registry (synthesis v1–v4, expansion v1–v2) with `prompt_version` / `qe_version` selection and `FALLBACK_PROMPTS`

### 1.7 Search UI
- [x] SSE parsing in `streamSearch()` and `PipelineLoader` with real backend steps
- [x] Streaming markdown answer, source cards, `TabularSnippet`, `DocumentDetailPanel`
- [x] `AnswerTrace` for SQL/hybrid answers; `FeedbackModal` writing to `feedback`

### 1.8 Data and security
- [x] Tables: `profiles`, `oauth_tokens`, `document_chunks` (HNSW cosine), `sheet_registry`, `prompt_templates`, `feedback`
- [x] RLS (`auth.uid() = user_id`) on all user tables; service-role policy on `sheet_registry`
- [x] `match_documents` RPC filtered by user
- [x] Per-user table naming `u_<uid-hex>_<slug>` within the 63-byte limit
- [x] Feature flags: `ENABLE_SQL_ROUTER`, `ENABLE_HYBRID`, `SQL_USER_ALLOWLIST`, `MATERIALIZE_SHEETS`

### 1.9 Evaluation and tooling
- [x] `run-evals.ts` + `golden-dataset.json` (Recall@K, Precision@K, MRR, factual containment, citations, LLM judge)
- [x] `run-sql-evals.ts` + `sql-golden.json`, `run-router-eval.ts`
- [x] Data setup scripts (`reindex.ts`, `replace-doc-ids.ts`, `shift-dates.ts`, Apps Script batches)
- [x] Utility scripts (`materialize-ravenstack.ts`, `test-sql-path.ts`)

---

## Section 2 — Remaining

Priorities: **P0** correctness/security, **P1** quality and reliability, **P2** scale/feature work.

### 2.1 P0 — Correctness and security debt
- [ ] **Encrypt OAuth tokens at rest.** Tokens are plaintext in `oauth_tokens` (RLS only). Use Supabase Vault or app-level encryption.
- [x] **Complete "Delete account".** `delete-account` drops the user's `sheets.u_<uid>_*` tables, deletes `search_trace` rows, then deletes the auth user (cascades `profiles`, `oauth_tokens`, `document_chunks`, `sheet_registry`, `feedback`).
- [x] **Real Google token expiry.** `store-oauth-tokens` reads `exp` / `expires_in` from Google's tokeninfo endpoint. The client no longer sends a 1-hour guess.
- [x] **Fix stale config.** Removed functions are gone from `supabase/config.toml`. `store-oauth-tokens` no longer records `calendar.readonly`. Site URL stays `http://localhost:5173` on purpose — production redirect URLs are set in the Supabase dashboard, not by pushing this file.
- [ ] **Review `verify_jwt = false` functions.** Confirm each does an in-function `getUser()` check, or turn JWT verification back on.
- [ ] **Align default threshold docs.** The code default is 0.5 but `CLAUDE.md` says 0.3. Update the docs or the code.

### 2.2 P1 — Retrieval and ingestion quality
- [ ] **Unify chunk-size defaults.** Function default is 800/200 and Settings is 1600/400. Pick one source of truth. Dashboard auto-index should use it too.
- [ ] **Real PDF/Office parsing.** Replace `sanitizeBinaryText` (UTF-8 decode) with proper extraction, or use the Drive export API for Office files.
- [ ] **Offset-paging robustness.** Make indexing resilient to the Drive file list changing mid-run (stable cursor or snapshot of the file list).
- [ ] **Generalize the planner prompt.** Remove Ravenstack-specific gotchas. Generate hints from `sheet_registry` metadata.
- [ ] **Hybrid lexical + vector retrieval.** Call the existing `keyword_search` RPC (`fts` column) and merge with vector results (e.g. reciprocal rank fusion). Validate with evals.
- [ ] **Move inline prompts into the registry.** Planner, SQL synthesis and hybrid synthesis, so they can be versioned and A/B tested.

### 2.3 P1 — Observability
- [ ] **Persist traces.** Write to the existing `search_trace` table from `search-documents` (query, mode, SQL, latency, model, row count).
- [ ] **LLM cost and latency tracking.** Record token usage per call.
- [ ] **Surface silent SQL fallbacks.** Log or flag the reason a SQL route fell back to vector, so SQL-path bugs are visible.

### 2.4 P2 — Performance and scale
- [ ] **Incremental table refresh.** Use the stored `header_hash`, `schema_hash` and `content_hash` in `materializeCsvAsTable` to skip or patch unchanged tables.
- [ ] **Schema prompt scaling.** Select relevant tables (e.g. by embedding table descriptions) instead of listing every table in the planner prompt.

### 2.5 P2 — Multi-tenancy and integrations
- [ ] **New data sources** (e.g. Notion, Jira). Add an OAuth function, sync function, Settings card, and a new `provider` value.

### 2.6 Testing and quality gates
- [ ] **Frontend tests.** Only `example.test.ts` exists. Add Vitest coverage for `streamSearch` and auth callbacks.
- [ ] **Edge function tests.** Cover the SQL executor allowlist (adversarial queries), chunkers, `parseCsv` and type inference.
- [ ] **Eval gating.** Run the eval suites in CI and fail on regression against recorded baselines.
- [ ] **Frontend data layer cleanup.** Move direct `supabase` calls in `useEffect` to React Query hooks. Use React Hook Form + Zod for forms.

### 2.7 Suggested sequencing
1. **Week 1 — P0 hardening:** token encryption, account deletion, token expiry, config cleanup, JWT review.
2. **Week 2 — Quality:** chunk defaults, trace persistence, adversarial SQL tests.
3. **Week 3 — Retrieval:** PDF/Office parsing, hybrid lexical retrieval, planner prompt generalization (re-run all evals after each).
4. **Week 4+ — Scale and expansion:** incremental refresh, new data sources, CI eval gating.
