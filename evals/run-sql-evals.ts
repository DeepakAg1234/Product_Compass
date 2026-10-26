// Text-to-SQL eval runner (Day 14). Runs the golden questions through the real
// router → generator → executor and scores:
//   - routing accuracy   (predicted mode == expected mode)
//   - exec pass rate     (generated SQL ran without error)
//   - scalar correctness (numeric result within tolerance of expected)
//   - tables jaccard     (|gen ∩ expected| / |gen ∪ expected|)
//
// Run from repo root:
//   SUPABASE_DB_URL='...session-pooler...' \
//     deno run --env-file=.env.evals --unsafely-ignore-certificate-errors=<host> \
//     --allow-net --allow-read --allow-env evals/run-sql-evals.ts
import { createPgClient } from "../supabase/functions/_shared/pg-client.ts";
import { buildSchemaPrompt, type RegistryRow } from "../supabase/functions/search-documents/registry.ts";
import { routeAndGenerate } from "../supabase/functions/search-documents/route-and-generate.ts";
import { runSql } from "../supabase/functions/search-documents/sql-executor.ts";
import { synthesizeHybridAnswer, synthesizeSqlAnswer } from "../supabase/functions/search-documents/synthesis.ts";
import { callClaude, HAIKU } from "../supabase/functions/_shared/anthropic.ts";

interface Golden {
  id: string; query: string; expected_mode: string; result_type: string;
  expected_value?: number; tolerance_rel?: number; min_rows?: number; expected_tables: string[];
}

const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
if (!apiKey) { console.error("ANTHROPIC_API_KEY missing (--env-file=.env.evals)"); Deno.exit(1); }
const UID = "8997243a-60eb-48f3-a0b7-a68bcc059b6c";

const golden: Golden[] = JSON.parse(await Deno.readTextFile(new URL("./sql-golden.json", import.meta.url)));
const sql = createPgClient();
const reg = (await sql.unsafe(
  `SELECT table_name, document_title, row_count, columns FROM sheet_registry WHERE user_id=$1`, [UID],
)) as unknown as RegistryRow[];
const schema = buildSchemaPrompt(reg);
const allowed = reg.map((r) => r.table_name);
// Map friendly titles → real table names so expected_tables can be compared.
const titleToTable = new Map(reg.map((r) => [r.document_title, r.table_name]));

const firstNumeric = (rows: Record<string, unknown>[]): number | null => {
  if (!rows.length) return null;
  for (const v of Object.values(rows[0])) {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
};
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / new Set([...a, ...b]).size;
};

// Warm up TLS/DB connection so the first question isn't skewed by cold start.
await callClaude({ apiKey: apiKey!, model: HAIKU, user: "hi", maxTokens: 5 });
await sql.unsafe("SELECT 1");

let routeHits = 0, execPass = 0, scalarTotal = 0, scalarHits = 0;
const jaccards: number[] = [];
const latencies: number[] = []; // full user-facing path per question (ms)

for (const g of golden) {
  const t0 = performance.now();
  const plan = await routeAndGenerate(g.query, schema, apiKey!);
  const planMs = Math.round(performance.now() - t0);
  const routeOk = plan.mode === g.expected_mode;
  if (routeOk) routeHits++;
  let detail = `route=${plan.mode}${routeOk ? "✓" : `✗(want ${g.expected_mode})`}`;
  let execMs = 0, synthMs = 0;

  if (g.expected_mode !== "vector" && plan.mode !== "vector") {
    try {
      const tE = performance.now();
      const exec = await runSql(sql, UID, plan.sql, allowed);
      execMs = Math.round(performance.now() - tE);
      if (exec.error) {
        detail += ` exec=ERR(${exec.error})`;
      } else {
        execPass++;
        const wantTables = g.expected_tables.map((t) => titleToTable.get(t) ?? t);
        const j = jaccard(plan.tables_used.map((t) => t.toLowerCase()), wantTables.map((t) => t.toLowerCase()));
        jaccards.push(j);
        detail += ` exec✓ rows=${exec.row_count} jaccard=${j.toFixed(2)}`;
        if (g.result_type === "scalar") {
          scalarTotal++;
          const got = firstNumeric(exec.rows ?? []);
          const tol = (g.tolerance_rel ?? 0) * Math.abs(g.expected_value ?? 0);
          const ok = got !== null && Math.abs(got - (g.expected_value ?? 0)) <= Math.max(tol, 1e-9);
          if (ok) scalarHits++;
          detail += ` value=${got}${ok ? "✓" : `✗(want ${g.expected_value})`}`;
        } else if (g.min_rows && (exec.row_count ?? 0) < g.min_rows) {
          detail += ` ⚠ rows<${g.min_rows}`;
        }
        // Include answer synthesis so the timing reflects real user latency.
        const tS = performance.now();
        if (plan.mode === "hybrid") {
          await synthesizeHybridAnswer(g.query, exec.rows ?? [], exec.row_count ?? 0, exec.truncated ?? false, [], apiKey!);
        } else {
          await synthesizeSqlAnswer(g.query, exec.rows ?? [], exec.row_count ?? 0, exec.truncated ?? false, apiKey!);
        }
        synthMs = Math.round(performance.now() - tS);
      }
    } catch (e) {
      detail += ` GEN-ERR(${(e as Error).message})`;
    }
  }
  const totalMs = planMs + execMs + synthMs;
  latencies.push(totalMs);
  detail += `  [plan ${planMs} exec ${execMs} synth ${synthMs} = ${totalMs}ms]`;
  console.log(`${g.id.padEnd(7)} ${routeOk ? "✅" : "❌"} ${detail}`);
}
await sql.end();

const n = golden.length;
const sqlN = golden.filter((g) => g.expected_mode !== "vector").length;
const avgJ = jaccards.length ? (jaccards.reduce((a, b) => a + b, 0) / jaccards.length) : 0;
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
console.log("\n──────── SUMMARY ────────");
console.log(`router_accuracy:    ${routeHits}/${n} (${(100 * routeHits / n).toFixed(0)}%)`);
console.log(`sql_exec_pass_rate: ${execPass}/${sqlN} (${(100 * execPass / sqlN).toFixed(0)}%)`);
console.log(`scalar_correctness: ${scalarHits}/${scalarTotal}`);
console.log(`tables_used_jaccard (avg): ${avgJ.toFixed(2)}`);
console.log(`latency ms — avg/p95/p99/max: ${Math.round(avg(latencies))} / ${pct(latencies, 0.95)} / ${pct(latencies, 0.99)} / ${Math.max(...latencies)}`);
console.log(`(n=${latencies.length}; p95/p99 ≈ max at this sample size)`);
