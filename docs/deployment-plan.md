# PM Compass — Deployment Plan

Frontend and backend deploy separately. Vercel serves the Vite SPA. Supabase Cloud (`rdppfdfkocgvrfggmmpu`, organization project “Product Compass”) holds Postgres, Auth, and Edge Functions.

The repo docs also name an older project (`umxpfhudmrqcwpeuveuq`, `pmcompass.vercel.app`). Confirm the target before every command below. This plan deploys the linked project, `rdppfdfkocgvrfggmmpu`.

Do not commit `.env`, `.env.evals`, or `BUILD_GUIDE.md`. They are gitignored because they hold secrets.

## 1. What ships

| Piece | Where | How |
| --- | --- | --- |
| SPA (`dist/`) | Vercel | `npm run build`, SPA rewrite in `vercel.json` |
| `store-oauth-tokens` | Supabase | `supabase functions deploy store-oauth-tokens` |
| `index-documents` | Supabase | `supabase functions deploy index-documents` |
| `search-documents` | Supabase | `supabase functions deploy search-documents` |
| `delete-account` | Supabase | `supabase functions deploy delete-account` |
| Schema | Supabase | `supabase db push --linked` (16 files in `supabase/migrations/`) |

`_shared/` is bundled with the functions. It is not deployed on its own. Evals, Apps Script, and local scripts stay off production.

Each function sets `verify_jwt = false` in `supabase/config.toml` and checks the caller with `supabase.auth.getUser()` inside the handler. Keep that pairing when you deploy.

## 2. Preconditions

- Node 18+ and npm. Supabase CLI logged in and linked to `rdppfdfkocgvrfggmmpu` (`supabase/.temp/project-ref`).
- Vercel CLI logged in, or a Git-connected Vercel project. A Git deploy only includes committed, pushed files. `vercel --prod` from this folder ships the working tree.
- Google Cloud OAuth client (Web) with Drive API and Docs API enabled. Authorized redirect URI:

  `https://rdppfdfkocgvrfggmmpu.supabase.co/auth/v1/callback`

- Same Client ID and secret stored in Supabase Auth → Providers → Google, and as Edge Function secrets.

Local auth config is still localhost-only:

- Site URL: `http://localhost:5173`
- Redirects: `http://localhost:5173/**`, `http://localhost:5173/auth/callback`

Set the production Site URL and redirect allow list in the Supabase dashboard. Do not `supabase config push` this `config.toml` onto the cloud project; that would point Auth at localhost.

The app sends users back to `${window.location.origin}/auth/callback` (`src/lib/google-auth.ts`).

## 3. Environment

**Vercel (build-time, `VITE_` prefix).** Copy from the local `.env` into the Vercel project for Production (and Preview if you use it).

| Name | Source |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://rdppfdfkocgvrfggmmpu.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | anon / publishable key. Never the secret or service_role key. |
| `VITE_SUPABASE_PROJECT_ID` | `rdppfdfkocgvrfggmmpu` |

A missing URL or key fails at startup in `src/integrations/supabase/client.ts`. Redeploy the frontend after changing any `VITE_` variable; Vite inlines them at build time.

**Supabase Edge Function secrets.** Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Do not create custom secrets whose names start with `SUPABASE_`.

| Name | Required for |
| --- | --- |
| `OPENAI_API_KEY` | Embeddings on index and search (`text-embedding-3-small`) |
| `ANTHROPIC_API_KEY` | Query expansion, synthesis, text-to-SQL |
| `GOOGLE_CLIENT_ID` | Token refresh during indexing |
| `GOOGLE_CLIENT_SECRET` | Token refresh during indexing |
| `DATABASE_URL` | Direct Postgres URI. Sheet materialization and text-to-SQL. |

Optional, leave unset for the first deploy:

| Name | Effect |
| --- | --- |
| `LLM_PROVIDER`, `LLM_MODEL`, `OPENROUTER_API_KEY` | Swap the LLM off Anthropic |
| `ENABLE_SQL_ROUTER` | Planner can choose SQL. Default off: every query stays on vector search. |
| `ENABLE_HYBRID` | SQL rows plus verbatim evidence. Default off. |
| `MATERIALIZE_SHEETS` | Indexing writes `sheets.u_*` tables and `sheet_registry`. Default off. |
| `SQL_USER_ALLOWLIST` | Restrict the SQL router to specific user ids. |

Apply secrets with `supabase secrets set --env-file .env` only after stripping frontend and eval keys, or set the backend names one by one in the dashboard. A full `.env` upload would also send `SUPABASE_SERVICE_ROLE_KEY` and eval passwords as custom secrets.

## 4. Order of operations

Run from the repo root.

1. **Preflight locally**

   ```bash
   npm install
   npm run lint
   npm run test
   npm run build
   ```

   `npm run build` must finish and write `dist/`. Fix a broken build before either host.

2. **Migrations**

   ```bash
   supabase db push --linked
   ```

   This applies only migrations not already on `rdppfdfkocgvrfggmmpu`. Do not edit a migration that has already been applied; add a new file.

   Expect, among others: `profiles`, `oauth_tokens`, `document_chunks` (pgvector HNSW), `sheet_registry`, `prompt_templates`, `feedback`, `search_trace`, the `match_documents` RPC, and the `sheets` schema / `sheets_reader` role from `20260606120001_sheets_reader.sql`.

3. **Secrets**

   Set the five required Edge Function secrets in section 3. Leave the SQL flags unset for the first production cut so search is vector-only.

4. **Functions**

   ```bash
   supabase functions deploy store-oauth-tokens
   supabase functions deploy index-documents
   supabase functions deploy search-documents
   supabase functions deploy delete-account
   ```

   Deploy `store-oauth-tokens` before asking anyone to sign in. Index and search can go out in either order after that. `delete-account` needs `DATABASE_URL` when the user has materialized sheet tables.

5. **Auth URLs (dashboard, not config push)**

   On project `rdppfdfkocgvrfggmmpu`:

   - Site URL: the production origin, for example `https://<your-vercel-domain>`.
   - Redirect allow list: `https://<your-vercel-domain>/auth/callback` and `http://localhost:5173/auth/callback` if local login should keep working.
   - Google provider: Client ID and secret match `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

6. **Frontend**

   Set the three `VITE_` variables, then:

   ```bash
   vercel --prod
   ```

   Or push the release commit if the Vercel project builds from Git. `vercel.json` sets `framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`, and rewrites `/(.*)` to `/`.

7. **Smoke test** (section 6) before turning on SQL flags.

## 5. Text-to-SQL, after vector search works

Turn these on in order. Each step depends on the one before it.

1. `MATERIALIZE_SHEETS=true`, then redeploy `index-documents` if the secret was missing at deploy time (secrets are read at runtime, so a redeploy is only needed if the function was not picking up env changes).
2. Re-index from the Dashboard so CSVs become `sheets.u_<uid>_<slug>` tables and `sheet_registry` rows.
3. `ENABLE_SQL_ROUTER=true`. Optionally set `SQL_USER_ALLOWLIST` to your user id first.
4. `ENABLE_HYBRID=true` only after a SQL answer looks right.

Any SQL failure falls back to vector search. The UI still returns an answer. Check function logs if analytical questions look like document summaries.

The planner prompt is tuned to the Ravenstack sample schema. General Drive sheets can route or generate SQL poorly until that prompt is generalized.

## 6. Smoke test

| Step | Pass |
| --- | --- |
| Open `/` | Landing loads, no blank screen, no missing-env error in the console |
| Sign in with Google | Lands on `/auth/callback`, then Dashboard. `store-oauth-tokens` returns success |
| Dashboard index | Progress advances. `index-documents` logs show chunks written. `offset=0` deletes that user’s existing chunks, so the first production index is a clean slate |
| `/search?q=...` | Streamed answer, source cards, no stuck loader |
| Settings | Sign-out works. Sign-out deletes that user’s `oauth_tokens` rows |
| Deep link | Refresh on `/search` and `/settings` stays on the SPA (rewrite to `/`) |

SQL checks, only after section 5: a count or total question returns an `AnswerTrace`, and a nonsense question still gets a vector answer.

## 7. Rollback

| Failure | Action |
| --- | --- |
| Bad frontend | Vercel → previous deployment → Promote |
| Bad function | Redeploy the last known-good source: `supabase functions deploy <name>` |
| SQL path misbehaving | Unset `ENABLE_SQL_ROUTER` and `ENABLE_HYBRID`. Search returns to vector immediately |
| Bad migration | Add a forward migration. Do not edit an applied file |

## 8. Known gaps that do not block this deploy

Tracked in `docs/implementation-plan.md`. Ship vector search with them still open:

- OAuth tokens are plaintext in `oauth_tokens` (RLS only).
- PDFs and Office files are decoded as UTF-8, so those search results are weak.

Already fixed in this repo, and included in the function deploy above:

- `delete-account` drops `sheets.u_<uid>_*` tables, deletes `search_trace`, and deletes the auth user. Settings calls that function.
- `store-oauth-tokens` stores Google's real `exp` / `expires_in` and does not record `calendar.readonly`.
- `config.toml` does not list removed meeting functions. Its Site URL stays localhost so this file is not pushed over the dashboard Auth URLs.

## 9. Command summary

```bash
npm run lint && npm run test && npm run build
supabase db push --linked
supabase functions deploy store-oauth-tokens
supabase functions deploy index-documents
supabase functions deploy search-documents
supabase functions deploy delete-account
vercel --prod
```

Then set production Auth redirect URLs, run the smoke test, and only then enable `MATERIALIZE_SHEETS` → re-index → `ENABLE_SQL_ROUTER` → `ENABLE_HYBRID`.
