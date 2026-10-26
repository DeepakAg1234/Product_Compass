// THROWAWAY (Days 7-9) — exercises the full text-to-SQL path against the real
// Claude API + database, outside the edge function. Run:
//   SUPABASE_DB_URL='...session-pooler...' \
//     deno run --env-file=.env.evals --unsafely-ignore-certificate-errors=<host> \
//     --allow-net --allow-read --allow-env scripts/test-sql-path.ts
import { createPgClient } from "../supabase/functions/_shared/pg-client.ts";
import { buildRegistrySummary, buildSchemaPrompt, type RegistryRow } from "../supabase/functions/search-documents/registry.ts";
import { routeQuery } from "../supabase/functions/search-documents/router.ts";
import { generateSql } from "../supabase/functions/search-documents/sql-generator.ts";
import { runSql } from "../supabase/functions/search-documents/sql-executor.ts";
import { synthesizeSqlAnswer } from "../supabase/functions/search-documents/synthesis.ts";

const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
if (!apiKey) { console.error("ANTHROPIC_API_KEY missing (use --env-file=.env.evals)"); Deno.exit(1); }
const UID = "8997243a-60eb-48f3-a0b7-a68bcc059b6c";

const sql = createPgClient();
const reg = await sql.unsafe(
  `SELECT table_name, document_title, row_count, columns FROM sheet_registry WHERE user_id=$1 ORDER BY document_title`,
  [UID],
);
const rows = reg as unknown as RegistryRow[];
const summary = buildRegistrySummary(rows);
const schema = buildSchemaPrompt(rows);
const allowed = rows.map((r) => r.table_name);

const questions = [
  "How many accounts are on the Enterprise plan?",
  "What's the average MRR across all active subscriptions?",
  "Break down account count by industry, descending.",
  "What's the churn rate by plan tier? Show as a percentage.",
  "Which 5 features are used most by Enterprise accounts?",
  "How many open support tickets are there?",
  "Of accounts that churned citing pricing, what does their feedback say?",
  "What does our product retention strategy doc recommend?", // expect: vector
];

for (const q of questions) {
  console.log("━".repeat(80));
  console.log("Q:", q);
  const d = await routeQuery(q, summary, apiKey!);
  console.log(`  route → ${d.mode}  conf=${d.confidence}  (${d.router_ms}ms)  ${d.reason}`);
  if (d.mode === "vector") { console.log("  → vector path (unchanged)\n"); continue; }

  const useSonnet = d.confidence < 0.7;
  try {
    const gen = await generateSql(q, schema, apiKey!, useSonnet);
    const exec = await runSql(sql, UID, gen.sql, allowed);
    if (exec.error) {
      console.log(`  ❌ SQL error (${gen.model}): ${exec.error}`);
      console.log(`     sql: ${gen.sql}`);
    } else {
      const answer = await synthesizeSqlAnswer(q, exec.rows!, exec.row_count!, exec.truncated!, apiKey!);
      console.log(`  ✅ ${gen.model}  rows=${exec.row_count}  exec=${exec.elapsed_ms}ms`);
      console.log(`     ANSWER: ${answer}`);
    }
  } catch (e) {
    console.log(`  ❌ ${(e as Error).message}`);
  }
  console.log();
}
await sql.end();
