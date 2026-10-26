# PM Compass — Text-to-SQL Build Plan

> **For Claude (new session): read this file end-to-end before any code changes. It is the complete, executable plan. Start at §11 (Build Plan, Day 1). Don't re-design — every architectural decision is logged in §15 with rationale.**

---

## 1. TL;DR

Build text-to-SQL alongside the existing vector RAG so PMs can ask analytical questions ("churn rate by plan tier?") against materialized Google Sheets and get **exact numeric answers**, not LLM-summarized prose.

- **Data**: 5 RavenStack CSVs at `evals/data/ravenstack/` (accounts, churn_events, feature_usage, subscriptions, support_tickets) — relational, joined on `account_id`.
- **Why now**: Current pipeline indexes these as fuzzy chunks. Wrong shape for counts/rates. Eval gap on quantitative queries.
- **Expected lift**: Factual containment on numeric queries ~20% → >85%. Unlocks a new query class entirely.
- **Effort**: 15 working days, fully flag-gated, zero behavior change until flipped.
- **Current model**: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) for everything. Sonnet 4.5 reserved for low-confidence SQL generation.

---

## 2. System Overview

```
Drive CSV ──► index-documents ──► [parse → infer → COPY] ──► sheets.u_<uid>_<name>
                                          │                          │
                                          └──► sheet_registry ◄──────┘ (RLS)
                                                       │
User query ──► search-documents ──► router(Haiku) ─────┤
                            ┌─────────────┼─────────────┼──────────────┐
                            ▼             ▼             ▼              ▼
                          vector       sql-gen       hybrid         (fallback)
                          (existing)   (Haiku/Sonnet) parallel SQL+vec
                            │             ▼             ▼
                            │      sql-executor → reconcile by account_id
                            └─────────────►synthesis(Claude)──► answer + trace
                                                       │
                                          search_trace (observability)
```

---

## 3. New components & file locations

| Component | Path | Purpose |
|---|---|---|
| `sheet_registry` table | `supabase/migrations/20260606_sheet_registry.sql` | Single source of truth: which tables exist for which user |
| `sheets_reader` role | `supabase/migrations/20260606_sheets_reader.sql` | Read-only Postgres role used by SQL executor |
| `execute_sheet_sql` function | same migration | SECURITY DEFINER wrapper that sets role + GUC + timeouts |
| Materialization helper | `supabase/functions/index-documents/materialize-sql.ts` (new) | CSV → typed Postgres table + registry row |
| Shared pg client | `supabase/functions/_shared/pg-client.ts` (new) | Deno `postgres` driver — needed because `supabase-js` can't `SET LOCAL ROLE` or `COPY FROM STDIN` |
| Query router | `supabase/functions/search-documents/router.ts` (new) | Haiku classifier: `sql / vector / hybrid` |
| Text-to-SQL generator | `supabase/functions/search-documents/sql-generator.ts` (new) | Haiku → SQL (Sonnet on low confidence) |
| SQL executor | `supabase/functions/search-documents/sql-executor.ts` (new) | AST allowlist + role swap + execute |
| Synthesis adapter | `supabase/functions/search-documents/synthesis.ts` (new, extracted) | Mode-aware context builder for Claude |
| Hybrid reconciliation | `supabase/functions/search-documents/index.ts` (~L205-234, modified) | Parallel SQL + vector, join on `account_id` |
| `/sql-debug` (throwaway) | `supabase/functions/sql-debug/index.ts` (new — delete in Week 3) | Test harness for executor and generator in isolation |
| Frontend trace panel | `src/components/search/AnswerTrace.tsx` (new) | "How I got this answer" UI |
| Code block component | `src/components/search/CodeBlock.tsx` (new, ~30 lines) | Shadcn doesn't ship one |

### New env vars (search-documents edge function)
- `ENABLE_SQL_ROUTER` (default `false`) — full kill switch
- `ENABLE_HYBRID` (default `false`) — hybrid downgrades to vector when off
- `SQL_USER_ALLOWLIST` (CSV of user_ids; empty = all) — gradual rollout
- `MATERIALIZE_SHEETS` (index-documents, default `false`) — turn on per-user backfill

---

## 4. Migration SQL (paste-ready for Day 1)

### 4.1 `supabase/migrations/20260606_sheet_registry.sql`

```sql
CREATE SCHEMA IF NOT EXISTS sheets;

CREATE TABLE public.sheet_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id     text NOT NULL,
  document_title  text NOT NULL,
  sheet_name      text NOT NULL DEFAULT '_default',
  table_name      text NOT NULL,                  -- qualified as sheets.<table_name>
  schema_name     text NOT NULL DEFAULT 'sheets',
  columns         jsonb NOT NULL,                 -- [{name,type,nullable,sample_values:[3]}]
  source_headers  text[] NOT NULL,                -- raw, pre-sanitize
  header_hash     text NOT NULL,                  -- sha256(sorted source_headers)
  schema_hash     text NOT NULL,                  -- sha256(columns sans samples)
  content_hash    text,                           -- sha256(raw CSV bytes); for resync diff
  row_count       int4 NOT NULL DEFAULT 0,
  semantic_hints  jsonb,                          -- {table_description, column_descriptions}
  sql_enabled     bool NOT NULL DEFAULT true,     -- per-table disable for SQL routing
  indexed_at      timestamptz NOT NULL DEFAULT now(),
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_id, sheet_name),
  UNIQUE (table_name)
);

CREATE INDEX sheet_registry_user_idx ON public.sheet_registry (user_id);
CREATE INDEX sheet_registry_doc_idx  ON public.sheet_registry (user_id, document_id);

ALTER TABLE public.sheet_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY sr_owner_select ON public.sheet_registry
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY sr_service_all  ON public.sheet_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### 4.2 `supabase/migrations/20260606_sheets_reader.sql`

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sheets_reader') THEN
    CREATE ROLE sheets_reader NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA sheets TO sheets_reader;
REVOKE CREATE ON SCHEMA sheets FROM sheets_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA sheets
  GRANT SELECT ON TABLES TO sheets_reader;

-- Defense in depth: deny everything else
REVOKE ALL ON SCHEMA public             FROM sheets_reader;
REVOKE ALL ON SCHEMA auth               FROM sheets_reader;
REVOKE ALL ON SCHEMA storage            FROM sheets_reader;
REVOKE ALL ON SCHEMA information_schema FROM sheets_reader;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_catalog FROM sheets_reader;

GRANT sheets_reader TO service_role;  -- so SET ROLE works
```

### 4.3 RLS template (applied per mirror table by materializer)

```sql
ALTER TABLE sheets.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheets.<table> FORCE ROW LEVEL SECURITY;  -- applies even to owner

CREATE POLICY rls_user ON sheets.<table>
  FOR SELECT TO sheets_reader
  USING (current_setting('request.user_id', true) = '<uid>');

GRANT SELECT ON sheets.<table> TO sheets_reader;
```

`FORCE` is non-negotiable: without it, the table owner (service role) bypasses RLS and a misconfigured executor could read across users.

### 4.4 `execute_sheet_sql` wrapper

```sql
CREATE OR REPLACE FUNCTION public.execute_sheet_sql(
  p_user_id uuid,
  p_sql     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sheets, pg_temp
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF p_sql !~* '^\s*select\b' THEN
    RAISE EXCEPTION 'only SELECT permitted';
  END IF;

  PERFORM set_config('request.user_id', p_user_id::text, true);
  SET LOCAL ROLE sheets_reader;
  SET LOCAL statement_timeout = '5s';
  SET LOCAL idle_in_transaction_session_timeout = '5s';
  SET LOCAL lock_timeout = '1s';

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', p_sql)
    INTO v_rows;

  RESET ROLE;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.execute_sheet_sql(uuid, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.execute_sheet_sql(uuid, text) TO service_role;
```

### 4.5 Observability table

```sql
CREATE TABLE public.search_trace (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  query           text NOT NULL,
  mode            text NOT NULL,                  -- sql|vector|hybrid
  router_reason   text,
  router_confidence numeric(3,2),
  router_ms       int4,
  sql_raw         text,                           -- LLM output, pre-allowlist
  sql_executed    text,                           -- post-AST-rewrite
  sql_tables      text[],
  sql_rejected_reason text,
  exec_ms         int4,
  row_count       int4,
  truncated       bool,
  vector_chunks   int4,
  synth_input_chars int4,
  synth_output_chars int4,
  synth_ms        int4,
  total_ms        int4,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.search_trace (user_id, created_at DESC);
CREATE INDEX ON public.search_trace (mode, created_at DESC);
CREATE INDEX ON public.search_trace (created_at DESC) WHERE error IS NOT NULL;
ALTER TABLE public.search_trace ENABLE ROW LEVEL SECURITY;
CREATE POLICY st_owner ON public.search_trace USING (auth.uid() = user_id);
```

---

## 5. Materialization function

`supabase/functions/index-documents/materialize-sql.ts`

```ts
export async function materializeCsvAsTable(
  pg: PgClient,                  // dedicated postgres-js client, service role
  userId: string,
  file: DriveFile,
  rawCsv: string,
  sheetName = '_default',
): Promise<SheetRegistryRow> {

  // 1. Parse — RFC4180, quoted commas, CRLF, escaped quotes
  const { headers: rawHeaders, rows } = parseCsv(rawCsv);

  // 2. Sanitize headers; resolve duplicates deterministically
  const headers = sanitizeHeaders(rawHeaders);   // → snake_case, dedup with _2, _3

  // 3. Type inference over a 200-row sample
  const sample = rows.slice(0, 200);
  const colTypes = headers.map((h, i) => inferType(sample.map(r => r[i])));

  // 4. Hashes drive resync state machine
  const headerHash  = sha256(rawHeaders.join('|'));
  const schemaHash  = sha256(JSON.stringify(headers.map((h,i) => [h, colTypes[i].sql])));
  const contentHash = sha256(rawCsv);

  // 5. Table name — 63 byte Postgres limit
  const tableName = nameTable(userId, file.title, sheetName);  // u_<uidhex>_<slug>_<sheet>

  // 6. Single transaction: drop → create → copy → policies → grants
  await pg.begin(async tx => {
    await tx`CREATE SCHEMA IF NOT EXISTS sheets`;
    await tx.unsafe(`DROP TABLE IF EXISTS sheets.${tableName} CASCADE`);
    await tx.unsafe(buildCreateTable(tableName, headers, colTypes));

    const copyText = encodeCopy(rows, colTypes);   // bool "True"→t/f, ''→\N, dates ISO
    await tx.unsafe(
      `COPY sheets.${tableName} FROM STDIN WITH (FORMAT csv, NULL '\\N')`,
      copyText,
    );

    await tx.unsafe(buildRlsBlock(tableName, userId));
    await tx.unsafe(`GRANT SELECT ON sheets.${tableName} TO sheets_reader`);
  });

  // 7. Upsert registry
  const samples = buildSampleValues(rows, headers, 3);
  return upsertRegistry({
    userId, documentId: file.id, documentTitle: file.title,
    sheetName, tableName,
    columns: headers.map((h, i) => ({
      name: h, type: colTypes[i].sql,
      nullable: colTypes[i].nullable,
      sample_values: samples[h],
    })),
    sourceHeaders: rawHeaders,
    headerHash, schemaHash, contentHash,
    rowCount: rows.length,
  });
}
```

### Type inference rules (first match wins, over non-empty sample values)

| Order | Type | Rule |
|---|---|---|
| 1 | `bool` | All values ∈ `{"True","False","true","false","TRUE","FALSE","1","0"}` — RavenStack CSVs encode bools as `"True"`/`"False"` strings |
| 2 | `int4` | All values match `^-?\d+$` and fit int4 (use `int8` if exceeds) |
| 3 | `numeric` | All values match `^-?\d+(\.\d+)?$` and at least one has a decimal |
| 4 | `date` | All values match `^\d{4}-\d{2}-\d{2}$` (ISO — RavenStack format) |
| 5 | `timestamp` | All match `^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}` (`closed_at` in tickets) |
| 6 | `text` | Fallback |

- `nullable = true` if any sample row had empty string
- Empty strings → `\N` in COPY → handles `subscriptions.end_date`, `support_tickets.satisfaction_score`, `churn_events.feedback_text`
- **Force `numeric` if any decimal OR >50% nulls** to avoid int4↔numeric flip across syncs

### Re-sync strategy

| State | Action |
|---|---|
| No registry row | Full materialize |
| `headerHash` changed | Drop + recreate (column set differs) |
| `headerHash` same, `schemaHash` changed | Drop + recreate (column types drifted) |
| `schemaHash` same, `contentHash` changed | `TRUNCATE + COPY` in one tx (keeps grants/RLS/indexes) |
| All hashes same | No-op, bump `last_synced_at` |

Use temp-table swap for drop+recreate to keep reads available:
```sql
BEGIN;
CREATE TABLE sheets.<table>__new (...);
COPY sheets.<table>__new FROM STDIN ...;
DROP TABLE IF EXISTS sheets.<table>;
ALTER TABLE sheets.<table>__new RENAME TO <table>;
-- re-apply RLS + grants
COMMIT;
```

---

## 6. Query router

`supabase/functions/search-documents/router.ts`, called from `index.ts` between L175-L177.

**Input:** `{ query: string, user_id: uuid, registry_summary: string }`
where `registry_summary` is built from `sheet_registry` like:
`"accounts(500 rows: account_id, industry, country, …); churn_events(600 rows: …); …"`

**Output:** `{ mode: "sql"|"vector"|"hybrid", reason: string, confidence: 0.0-1.0 }`

**Prompt (Haiku, temp 0, 80 tokens):**
```
You classify a PM analytics query into a retrieval mode.
TABLES AVAILABLE: {registry_summary}
RULES:
- sql: question asks for counts, rates, sums, averages, comparisons, or filters that map cleanly to columns above.
- vector: question is about strategy, narrative, qualitative themes, or references docs not in TABLES.
- hybrid: structured filter + free-text feedback (e.g. "churned citing pricing — what did they say").
Return JSON: {"mode","reason","confidence"}.
QUERY: {query}
```

**Fallback:** confidence < 0.55 or JSON parse fail → `vector` (preserves current `/search` semantics).

---

## 7. Text-to-SQL generator

`supabase/functions/search-documents/sql-generator.ts`

**Model selection:**
- Default: Haiku 4.5
- Escalate to Sonnet 4.5 if `router.confidence < 0.7 AND mode = sql`

**Prompt skeleton (temp 0, 600 tokens):**
```
You write a single PostgreSQL SELECT for the user's question.
SCHEMA:
{for each table: CREATE TABLE … with column types AND 3 sample values per column from semantic_hints}
GOTCHAS:
- Booleans are real bool columns (already cast on import).
- subscriptions.end_date IS NULL means active.
- support_tickets.satisfaction_score IS NULL means unrated — exclude from avg unless asked.
- accounts.churn_flag may disagree with subscriptions.churn_flag; subscription-level is source of truth.
- Join feature_usage → accounts via subscriptions.
RULES:
- One SELECT only. No CTEs that write. No semicolons mid-query.
- Always LIMIT 1000.
- Use ILIKE for text filters on industry/country/reason_code.
- Output JSON: {"sql","tables_used","explanation"}.
QUERY: {query}
```

**Sample values in prompt** = the trick that gets `industry = 'FinTech'` right instead of `'fintech'`. Single biggest quality lever.

---

## 8. SQL executor — 5 layers of defense

`supabase/functions/search-documents/sql-executor.ts`

**Order of enforcement (any one blocks damage):**

| Layer | Mechanism | Catches |
|---|---|---|
| 1 | `sheets_reader` Postgres role | INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/COPY/GRANT — Postgres denies with `permission denied` |
| 2 | AST allowlist via `pgsql-ast-parser` | Non-SELECT ASTs, `pg_read_file`, `dblink`, `pg_sleep`, schema references to `auth`/`storage`/`pg_catalog`/`information_schema`, joins to non-registry tables |
| 3 | `BEGIN READ ONLY` + `statement_timeout=5s` + `lock_timeout=1s` | Time-based attacks, cartesian explosions, advisory-lock holds |
| 4 | LIMIT injection via AST rewrite (not append) | Unbounded result sets; correctly handles `UNION` shapes via wrapping |
| 5 | `SET LOCAL search_path = sheets` | Schema-less references to `users`, `oauth_tokens` resolve to non-existent `sheets.users` instead of leaking |

**Execution flow:**
```sql
BEGIN READ ONLY;
SET LOCAL ROLE sheets_reader;
SET LOCAL request.user_id = $uid;
SET LOCAL statement_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = sheets;
<generated SQL>;
ROLLBACK;
```

Returns `{ rows, row_count, truncated, elapsed_ms }`. On error: `{ error, sql }` — never throws to synthesizer.

---

## 9. Synthesis adapter

`supabase/functions/search-documents/synthesis.ts` (extracted from `index.ts` L274 area)

Context builder switches on mode:

- **SQL mode:** Serialize first 20 rows as markdown table + `"row_count: N (truncated: bool)"`. Prompt: *"Answer using ONLY these rows. State counts and percentages literally. If 0 rows, say so."*
- **Hybrid mode:** SQL table + selected vector chunks under `"Customer feedback evidence:"`. Prompt: *"One-paragraph answer that quotes 2-3 short verbatim phrases from feedback."*
- **Vector mode:** Unchanged.

Response shape stays `{ answer, sources, query }` with added optional `trace`:
```json
{ "mode": "sql|vector|hybrid", "sql": "...", "row_count": 42, "tables_used": [...], "router_reason": "..." }
```

---

## 10. Hybrid reconciliation

`search-documents/index.ts` L205-234 (replace `Promise.all` over `match_documents`).

```ts
const [vectorHits, sqlResult] = await Promise.all([
  Promise.all(expansions.map(q => rpcMatchDocuments(q))),    // existing
  routerDecision.mode !== 'vector'
    ? runSqlPath(query, registry, userId)
    : Promise.resolve(null),
]);
```

**When `mode === 'hybrid'`:**
1. SQL result gives set of `account_id`s (e.g. churned-with-pricing)
2. Build `account_id → row` map
3. Filter vector hits: keep chunks whose `metadata.account_id` is in SQL set
4. If vector hits don't carry `account_id`, fall back to text overlap on feedback snippets
5. Score = `0.6 * sql_match + 0.4 * vector_similarity`, top 7 into existing `seenChunks` map at L222

**Required upstream change (Day 11):** tabular chunker in `index-documents` must attach `metadata.account_id` when chunking `churn_events.feedback_text` rows.

---

## 11. 15-Day Build Plan

### Week 1 — Foundation

**Day 1 (Mon) — Registry + read-only role migrations**
- Files: `supabase/migrations/20260606_sheet_registry.sql`, `supabase/migrations/20260606_sheets_reader.sql` (paste from §4)
- DoD:
  ```sql
  SELECT * FROM sheet_registry;                                  -- empty, no error
  SELECT rolname FROM pg_roles WHERE rolname='sheets_reader';    -- 1 row
  SELECT has_schema_privilege('sheets_reader','sheets','USAGE'); -- t
  ```
- Risk: Low. Pure DDL.

**Day 2 (Tue) — RFC4180 CSV parser + type inference (pure fns)**
- Files: `supabase/functions/index-documents/materialize-sql.ts` (parser + inference exports only), `materialize-sql.test.ts`
- DoD: Deno tests on 3 RavenStack CSVs pass — quoted commas in `feedback_text` as one cell; `"True"/"False"` infers `bool`; `subscriptions.end_date` infers `date` with nulls.
- Risk: `satisfaction_score` int↔numeric flip. Mitigation: force `numeric` if any decimal OR >50% nulls.

**Day 3 (Wed) — Materialization writer**
- Files: `materialize-sql.ts` (add writer), `supabase/functions/_shared/pg-client.ts` (new)
- DoD: Manual invoke via throwaway `/materialize-debug`. Then:
  ```sql
  SELECT count(*) FROM sheets.u_<uid>_accounts;                  -- 500
  SELECT * FROM sheet_registry WHERE document_title='accounts';  -- 1 row
  ```
- Risk: `COPY FROM STDIN` over Deno `postgres` driver. Fallback: parameterized batch INSERT (decide by noon).

**Day 4 (Thu) — RLS templating + per-table grants**
- DoD:
  ```sql
  SET ROLE sheets_reader;
  SET request.user_id = '<wrong-uid>';
  SELECT * FROM sheets.u_<right-uid>_accounts;    -- 0 rows
  SET request.user_id = '<right-uid>';
  SELECT count(*) FROM sheets.u_<right-uid>_accounts;  -- 500
  RESET ROLE;
  ```
- Risk: Forgetting `FORCE RLS` on owner. Verify `sheets_reader` is NOT owner.

**Day 5 (Fri) — Wire into `index-documents`, backfill 5 CSVs**
- ⚠️ Tightest day — split wiring (AM) from debugging (PM)
- DoD: 5 registry rows present; existing vector search regression-clean on one prose query.

### Week 2 — Query Path

**Day 6 (Mon) — SQL executor + AST guardrails (isolated)**
- Files: `sql-executor.ts`, `sql-debug/index.ts` (throwaway), add `pgsql-ast-parser` to import_map
- DoD: 5 curl tests pass — count works, DROP blocked, `auth.users` blocked, `pg_sleep` timeout, LIMIT injected.
- Risk: `pgsql-ast-parser` ESM under Deno. Fallback: `node-sql-parser` (decide mid-morning).

**Day 7 (Tue) — Router**
- DoD: 6/7 RavenStack questions routed correctly, no `vector→sql` misroutes.
- Risk: Confidence threshold tuning. Log every fallback for audit.

**Day 8 (Wed) — SQL generator**
- ⚠️ Highest variance day
- DoD: 5/7 first-gen correct; 7/7 after one tweak. Verify `industry ILIKE 'FinTech'` (sample-values nudge); bools as bools; `end_date IS NULL` for active.
- Risk: If Sonnet-escalation rate >40%, prompt needs structural rework. Flag Day 9 buffer.

**Day 9 (Thu) — Synthesis adapter (SQL mode)**
- DoD: E2E via `/sql-debug?synthesize=true` returns answer string containing "18" (the percentage), grounded in row count.
- Risk: Over-hedging tone. Iterate before Day 10.

**Day 10 (Fri) — Wire into `/search`, flag OFF**
- DoD: Flag OFF — existing eval suite unchanged. Flag ON staging — 7 questions return SQL-grounded answers, p50 < 2.5s.
- Risk: Embed-skip on SQL routes.

### Week 3 — Hybrid + Evals + Ship

**Day 11 (Mon) — Tabular chunks carry `metadata.account_id`**
- DoD: `SELECT metadata->>'account_id' FROM document_chunks WHERE document_title='churn_events' LIMIT 5` → non-null UUIDs.

**Day 12 (Tue) — Hybrid reconciliation**
- DoD: Pricing-feedback query returns (a) a count, (b) 2+ verbatim feedback quotes, (c) `trace.mode='hybrid'`, (d) `tables_used` includes `churn_events`.
- Risk: Score weighting is a guess. Don't tune — capture in evals (Day 14).

**Day 13 (Wed) — Frontend `AnswerTrace.tsx`**
- Files: `src/components/search/AnswerTrace.tsx`, `src/pages/Search.tsx`, `src/components/search/CodeBlock.tsx`
- DoD: 3 traced queries from §14 show correct mode badge; SQL copy-able.
- Risk: None significant. Cosmetic — cut to `<pre>` if time-pressed.

**Day 14 (Thu) — Eval suite extensions**
- Files: `evals/golden-dataset.json` (extend with §12 entries), `evals/run-evals.ts` (new metrics: `sql_mode_accuracy`, `result_invariant_pass_rate`)
- DoD: `deno run … evals/run-evals.ts` produces report including new metrics. Baseline targets: router accuracy ≥85%, invariant pass ≥80%.
- Risk: ⚠️ `expected_sql` brittleness. If >2h: downgrade to "tables_used set match" + manual quality check.

**Day 15 (Fri) — Full eval, tune, flip prod flags**
- DoD: All 7 RavenStack questions work in prod UI; trace panel correct; latency p50 < 2.5s SQL / < 4s hybrid; prose queries unchanged.
- **Kill rule: any p0 regression → flags stay OFF, no exceptions.** Code stays merged dark.

---

## 12. The 10 new evals (paste into `evals/golden-dataset.json`)

> **Numerics are placeholders** — replace with actuals after the first materialization run.

```json
[
  {
    "id": "sql-01",
    "query": "How many accounts are on the Enterprise plan?",
    "query_type": "sql",
    "difficulty": "easy",
    "expected_tables": ["accounts"],
    "expected_result_shape": "scalar",
    "expected_result": 87,
    "expected_sql": "SELECT COUNT(*) FROM accounts WHERE plan_tier = 'Enterprise'",
    "expected_answer_contains": ["87", "Enterprise"],
    "result_tolerance": {"numeric_abs": 0}
  },
  {
    "id": "sql-02",
    "query": "What's the average MRR across all active subscriptions?",
    "query_type": "sql",
    "difficulty": "easy",
    "expected_tables": ["subscriptions"],
    "expected_result_shape": "scalar",
    "expected_result": 412.50,
    "expected_sql": "SELECT AVG(mrr_amount) FROM subscriptions WHERE end_date IS NULL AND mrr_amount > 0",
    "expected_answer_contains": ["average", "MRR"],
    "result_tolerance": {"numeric_rel": 0.01},
    "notes": "Tests end_date IS NULL = active; exclude mrr=0 trials"
  },
  {
    "id": "sql-03",
    "query": "Break down account count by industry, descending.",
    "query_type": "sql",
    "difficulty": "medium",
    "expected_tables": ["accounts"],
    "expected_result_shape": "table",
    "expected_result": [
      {"industry": "FinTech", "n": 142},
      {"industry": "EdTech", "n": 118},
      {"industry": "DevTools", "n": 96},
      {"industry": "HealthTech", "n": 84},
      {"industry": "Other", "n": 60}
    ],
    "expected_sql": "SELECT industry, COUNT(*) AS n FROM accounts GROUP BY industry ORDER BY n DESC",
    "result_match_keys": ["industry"],
    "expected_answer_contains": ["FinTech"],
    "result_tolerance": {"numeric_abs": 0}
  },
  {
    "id": "sql-04",
    "query": "Average resolution time for urgent tickets by priority.",
    "query_type": "sql",
    "difficulty": "medium",
    "expected_tables": ["support_tickets"],
    "expected_result_shape": "table",
    "expected_result": [{"priority": "urgent", "avg_hours": 4.2, "n": 198}],
    "expected_sql": "SELECT priority, ROUND(AVG(resolution_time_hours)::numeric,1) AS avg_hours, COUNT(*) AS n FROM support_tickets WHERE priority = 'urgent' GROUP BY priority",
    "result_match_keys": ["priority"],
    "expected_answer_contains": ["urgent", "hours"],
    "result_tolerance": {"numeric_rel": 0.05}
  },
  {
    "id": "sql-05",
    "query": "What's the churn rate by plan tier? Show as a percentage.",
    "query_type": "sql",
    "difficulty": "hard",
    "expected_tables": ["accounts", "churn_events"],
    "expected_result_shape": "table",
    "expected_result": [
      {"plan_tier": "Basic", "churn_rate_pct": 22.4, "churned": 47, "total": 210},
      {"plan_tier": "Pro", "churn_rate_pct": 14.1, "churned": 27, "total": 191},
      {"plan_tier": "Enterprise", "churn_rate_pct": 8.0, "churned": 8, "total": 99}
    ],
    "expected_sql": "SELECT a.plan_tier, ROUND(100.0*COUNT(DISTINCT ce.account_id)::numeric/COUNT(DISTINCT a.account_id),1) AS churn_rate_pct, COUNT(DISTINCT ce.account_id) AS churned, COUNT(DISTINCT a.account_id) AS total FROM accounts a LEFT JOIN churn_events ce ON ce.account_id=a.account_id GROUP BY a.plan_tier ORDER BY churn_rate_pct DESC",
    "result_match_keys": ["plan_tier"],
    "expected_answer_contains": ["Basic", "Enterprise", "%"],
    "result_tolerance": {"numeric_rel": 0.02},
    "notes": "DISTINCT critical — churn_events has reactivations"
  },
  {
    "id": "sql-06",
    "query": "Which 5 features are used most by Enterprise accounts?",
    "query_type": "sql",
    "difficulty": "hard",
    "expected_tables": ["accounts", "subscriptions", "feature_usage"],
    "expected_result_shape": "table",
    "expected_result": [
      {"feature_name": "feature_7", "total_usage": 18420},
      {"feature_name": "feature_12", "total_usage": 16104},
      {"feature_name": "feature_3", "total_usage": 15877},
      {"feature_name": "feature_22", "total_usage": 14233},
      {"feature_name": "feature_1", "total_usage": 13091}
    ],
    "expected_sql": "SELECT fu.feature_name, SUM(fu.usage_count) AS total_usage FROM feature_usage fu JOIN subscriptions s ON s.subscription_id=fu.subscription_id JOIN accounts a ON a.account_id=s.account_id WHERE a.plan_tier='Enterprise' GROUP BY fu.feature_name ORDER BY total_usage DESC LIMIT 5",
    "result_match_keys": ["feature_name"],
    "expected_answer_contains": ["feature_", "Enterprise"],
    "result_tolerance": {"numeric_rel": 0.0}
  },
  {
    "id": "sql-07",
    "query": "Of accounts that churned citing pricing, what does their feedback say? Is it really price or packaging?",
    "query_type": "hybrid",
    "difficulty": "hard",
    "expected_tables": ["churn_events", "accounts"],
    "expected_result_shape": "table",
    "expected_result": [{"account_id": "A-000123"}, {"account_id": "A-000457"}],
    "expected_sql": "SELECT ce.account_id, a.account_name, ce.feedback_text FROM churn_events ce JOIN accounts a ON a.account_id=ce.account_id WHERE ce.reason_code ILIKE 'pricing' AND ce.feedback_text <> ''",
    "result_match_keys": ["account_id"],
    "expected_answer_contains": ["packaging", "pricing"],
    "result_tolerance": {"numeric_abs": 5}
  },
  {
    "id": "sql-08",
    "query": "How many open support tickets are there?",
    "query_type": "sql",
    "difficulty": "easy",
    "expected_tables": ["support_tickets"],
    "expected_result_shape": "scalar",
    "expected_result": 124,
    "expected_sql": "SELECT COUNT(*) FROM support_tickets WHERE closed_at IS NULL",
    "expected_answer_contains": ["open"],
    "result_tolerance": {"numeric_abs": 0}
  },
  {
    "id": "sql-09",
    "query": "What's our trial-to-paid conversion rate?",
    "query_type": "sql",
    "difficulty": "medium",
    "expected_tables": ["subscriptions"],
    "expected_result_shape": "scalar",
    "expected_result": 31.8,
    "expected_sql": "SELECT ROUND(100.0*SUM(CASE WHEN is_trial=false THEN 1 ELSE 0 END)::numeric/COUNT(*),1) FROM subscriptions",
    "expected_answer_contains": ["%", "conversion"],
    "result_tolerance": {"numeric_rel": 0.05},
    "notes": "is_trial is bool — verifies COPY-time cast worked"
  },
  {
    "id": "sql-10",
    "query": "Average satisfaction score by priority, excluding unrated.",
    "query_type": "sql",
    "difficulty": "medium",
    "expected_tables": ["support_tickets"],
    "expected_result_shape": "table",
    "expected_result": [
      {"priority": "low", "avg_score": 4.1},
      {"priority": "medium", "avg_score": 3.7},
      {"priority": "high", "avg_score": 3.2},
      {"priority": "urgent", "avg_score": 2.9}
    ],
    "expected_sql": "SELECT priority, ROUND(AVG(satisfaction_score)::numeric,1) AS avg_score FROM support_tickets WHERE satisfaction_score IS NOT NULL GROUP BY priority",
    "result_match_keys": ["priority"],
    "expected_answer_contains": ["satisfaction"],
    "result_tolerance": {"numeric_rel": 0.05}
  }
]
```

### New eval metrics to add to `run-evals.ts`

| Metric | Computation |
|---|---|
| `sql_mode_accuracy` | `(predicted_mode == query_type) / total` for SQL/hybrid entries |
| `sql_exec_pass_rate` | Generated SQL executed without error AND result matches `expected_result` within `result_tolerance` |
| `schema_fidelity` | Generated SQL references only columns that exist in `expected_tables` (AST walk) |
| `tables_used_jaccard` | `|generated ∩ expected| / |generated ∪ expected|` over `expected_tables` |

---

## 13. Decision Gates (non-negotiable)

| Gate | When | Pass condition | If fail |
|---|---|---|---|
| **G1** | End of W1 (Day 5 Fri) | All 5 CSVs materialized, registry populated, RLS verified cross-tenant | **Stop.** Foundation wrong. Day 6 → data-quirk debugging, not query path |
| **G2** | End of W2 Day 8 (Wed) | SQL gen ≥5/7 first-generation; Sonnet escalation rate <50% | **Pause and rework prompt.** Options: JSON schema (not prose), few-shot from golden set, or split into intent-extract + SQL-gen |
| **G3** | End of W3 Day 14 (Thu) | Routing ≥85%, SQL exec ≥80%, zero `permission denied` in `search_trace` | **Flags stay OFF Friday.** Code merges dark, gaps logged in `next_steps_rag.md`. **Do not flip flags to hit a deadline.** |

---

## 14. Top 5 Risks + Mitigations

1. **SQL gen on multi-table joins (Day 8).** Haiku misses `feature_usage → subscriptions → accounts` path. → Sample values in prompt + Sonnet escalation gated by router confidence <0.7 + explicit `JOIN HINTS` block listing documented join paths. Escalation rate >40% triggers structural prompt rewrite before Day 10.

2. **AST bypass via SELECT-shaped attacks** (`SELECT pg_read_file()`, recursive CTEs). → Layer 1 `sheets_reader` denies even if AST passes; Layer 5 `search_path=sheets` makes `pg_catalog` unreachable; function-name blocklist inside AST walker covers named risks. Three independent things must break.

3. **Type inference flip on sparse-null columns** (`satisfaction_score` numeric↔int4 across syncs). → Force `numeric` if any decimal sampled OR >50% nulls; `schema_hash` drift triggers drop+recreate via temp-table swap; one COPY retry with `text` fallback.

4. **Router over-routing to SQL on ambiguous queries** ("what's our story on retention?" → SQL on `accounts` returns garbage). → Confidence <0.55 falls to vector; alert when `mode=sql AND row_count=0` exceeds 30%; `SQL_USER_ALLOWLIST` for gradual rollout.

5. **CSV header / cell-value prompt injection** (row containing `"SYSTEM: ignore filters"`). → Headers sanitized to `[a-z0-9_]` before any prompt; sample values wrapped in `EXAMPLES` block with literal-data preamble; cross-tenant injection blocked at RLS. All generated SQL logged to `search_trace`.

---

## 15. Decision Log (do not re-litigate)

- **Permanent mirror, not temp tables:** sub-50ms p50 reads; hybrid path needs the same tables vector path indexes against; re-COPYing per query burns the 5s executor budget.
- **Haiku for router, not Sonnet:** 80-token classification with deterministic JSON output — Haiku 4.5 hits >95% accuracy on this shape; latency matters more than marginal accuracy.
- **Sonnet only for SQL gen on low-confidence routes:** 4-table joins with bool-as-string + null-end_date gotchas occasionally break Haiku; gate by `confidence < 0.7` keeps median cost low.
- **Read-only role separate from service role:** SQL is LLM-authored — Postgres, not regex, must enforce SELECT-only. Defense in depth alongside AST allowlist.
- **AST allowlist, not regex:** `SELECT … FROM x WHERE y = 'DELETE FROM'` would defeat regex. AST rejects on node type — sound.
- **Registry in Postgres, not in-memory:** edge functions are stateless, multi-region, cold-start. Postgres is already RLS-aware.
- **Per-user table namespace (`u_<uid>_…`) + RLS GUC:** two layers — prompt-injected `SELECT … FROM sheets.u_<other>_…` still fails at policy check.
- **Materialize *and* chunk the same CSV:** vector still answers fuzzy questions on `feedback_text`; hybrid gets a shared `account_id` join key.
- **LIMIT 1000 via AST rewrite, not append:** appended LIMIT collides with existing LIMIT and breaks `UNION` shapes.
- **Router falls back to vector on low confidence:** preserves `/search` semantics; wrong `sql` route shows confusing empty table, wrong `vector` is status quo.
- **Boolean cast at COPY time:** every generated query would otherwise need `WHERE churn_flag = 'True'` — LLM gets this wrong ~20% of the time on similar schemas.
- **Sample values in the prompt:** cheapest fix for case-sensitive string filters without a separate value-canonicalization step.
- **Separate Deno `postgres` driver in executor:** `supabase-js` has no `SET LOCAL ROLE` and no `COPY FROM STDIN` — both required.

---

## 16. End-to-end flow traces (sanity checks)

### Pure SQL — "What's the churn rate for FinTech accounts in India?"

```json
// Router → output
{ "mode": "sql", "reason": "Asks for a rate over accounts filtered by industry and country", "confidence": 0.93 }

// SQL generator → output
{
  "sql": "SELECT ROUND(100.0 * SUM(CASE WHEN churn_flag THEN 1 ELSE 0 END) / COUNT(*), 2) AS churn_rate_pct, COUNT(*) AS n FROM accounts WHERE industry ILIKE 'FinTech' AND country = 'IN' LIMIT 1000",
  "tables_used": ["accounts"],
  "explanation": "Churn rate = churned / total for the filtered cohort"
}

// Executor → output
{ "rows": [{ "churn_rate_pct": 18.42, "n": 38 }], "row_count": 1, "truncated": false, "elapsed_ms": 41 }
```
Synthesis answer: *"FinTech accounts in India have an 18.4% churn rate (7 of 38 accounts)."*

### Pure vector — "What does our retention strategy doc say about FinTech?"

```json
{ "mode": "vector", "reason": "Asks about a narrative strategy doc, not structured tables", "confidence": 0.88 }
```
Skips SQL entirely. Existing flow runs unchanged. Trace shows `mode: vector`.

### Hybrid — "Which churned customers cited pricing as the reason?"

```json
{ "mode": "hybrid", "reason": "Structured filter (reason_code='pricing') plus free-text feedback summarization", "confidence": 0.81 }

// SQL gen
{
  "sql": "SELECT ce.account_id, a.account_name, a.industry, ce.churn_date, ce.feedback_text FROM churn_events ce JOIN accounts a ON a.account_id = ce.account_id WHERE ce.reason_code ILIKE 'pricing' AND ce.feedback_text <> '' ORDER BY ce.churn_date DESC LIMIT 1000",
  "tables_used": ["churn_events","accounts"]
}
```
Executor returns 47 rows; account IDs harvested into `Set`. Vector path runs in parallel. Reconciliation keeps 12 of 18 vector chunks whose `metadata.account_id` is in SQL set; drops Drive doc chunks (no `account_id`) because mode=hybrid prioritizes SQL-grounded evidence.

Synthesis answer: *"47 churned customers cited pricing. Their feedback splits: ~60% point to packaging (e.g. 'too many features I don't use'), ~25% mention competitor pricing, ~15% raw budget cuts. The pricing label often masks a packaging problem."*

---

## 17. Cost Ceiling (per query)

Pricing: Haiku 4.5 $1/M in / $5/M out. Sonnet 4.5 $3/M in / $15/M out. Embeddings $0.02/M.

| Path | Cost |
|---|---|
| Vector (current baseline) | $0.0054 |
| SQL (Haiku throughout) | $0.0065 |
| SQL (Sonnet escalation on gen) | $0.0098 |
| Hybrid | $0.0081 |
| Worst case (hybrid + Sonnet gen + 1 retry) | $0.0145 |

At 10k queries/day worst case: $150/day ceiling. Retry capped at 1 attempt (second parse failure → fall back to vector with `error` logged).

---

## 18. Explicitly NOT building

| Skip | Why |
|---|---|
| **Write-back to Sheets / CRUD** | `sheets_reader` denies INSERT/UPDATE by design. Value is analysis, not data entry. Write-back triples auth scope and undo complexity. |
| **Multi-step agentic SQL refinement** (auto-retry, plan→critique→regenerate) | One-shot with strong schema priming hits the bar. Agentic loops 3-5× latency + cost. Revisit only if eval pass <75% after prompt tuning. |
| **UI to edit the mirror** (rename tables, override types) | Every override = divergence between Drive and mirror. Fix inference rules, not UI. |
| **Cross-user JOINs across shared workspaces** | RLS is per-user via `request.user_id`. Needs a sharing model we don't have. Single-user multi-sheet JOINs (the RavenStack pattern) work today. |

---

## 19. Resumption checklist (for new session)

1. Confirm current git state: `git status` — branch should be `main`, no uncommitted SQL/TS changes from prior work.
2. Confirm RavenStack data still present: `ls evals/data/ravenstack/` — 5 CSVs.
3. Confirm Supabase project still alive: `umxpfhudmrqcwpeuveuq` (per `CLAUDE.md`).
4. Read this file end-to-end.
5. Start at §11 Day 1 — write the two migration files from §4.
6. Run DoD verification SQL in Supabase SQL editor.
7. Move to Day 2.

Do not modify existing edge functions until Day 5 (Week 1 Friday). Until then all work is additive: new migrations, new files, throwaway debug functions.

---

*Generated 2026-06-06 from a multi-agent workflow run. Architecture, migrations, evals, build sequence, and safety plan all grounded in actual code (`supabase/functions/index-documents/index.ts`, `supabase/functions/search-documents/index.ts`, `evals/run-evals.ts`) and actual data (5 RavenStack CSVs in `evals/data/ravenstack/`).*
