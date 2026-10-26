// Router-aware eval. Runs each golden question through the FULL deployed system
// (the router picks SQL / hybrid / vector) and scores each by the metric that
// actually applies:
//   - SQL / hybrid answers → answer correctness (expected phrases present in the answer)
//   - vector answers       → document recall@5 (+ answer correctness)
//
// This is the honest measure of the combined product. run-evals.ts scores
// everything as document recall, so it reads 0 for every SQL-answered question.
//
// Run (router must be ON for the eval user):
//   deno run --env-file=.env.evals --allow-net --allow-read --allow-env evals/run-router-eval.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EMAIL = Deno.env.get("EVAL_USER_EMAIL")!;
const K = 5;
const CONCURRENCY = 3;

async function getToken(): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  const { data: v, error } = await admin.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: "magiclink" });
  if (error || !v.session) throw new Error("auth failed: " + error?.message);
  return v.session.access_token;
}

/** Fraction of expected phrases present in the answer (case-insensitive). null if none expected. */
function phraseScore(answer: string, phrases?: string[]): number | null {
  if (!phrases?.length) return null;
  const a = answer.toLowerCase();
  return phrases.filter((p) => a.includes(String(p).toLowerCase())).length / phrases.length;
}

async function pooled<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) await fn(q.shift()!);
  }));
}

interface Row { id: string; category: string; mode: string; recall: number | null; ans: number | null }

const token = await getToken();
const golden = JSON.parse(await Deno.readTextFile(new URL("./golden-dataset.json", import.meta.url)));
const queries = golden.queries ?? golden;
const rows: Row[] = [];

console.log(`Running ${queries.length} queries through the full system (router on)...\n`);
await pooled(queries, CONCURRENCY, async (q: any) => {
  let mode = "error", answer = "", retrieved: string[] = [];
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/search-documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q.query }),
    });
    const data = await res.json();
    mode = data.trace?.mode ?? "vector";
    answer = data.answer ?? "";
    retrieved = (data.sources ?? []).map((s: any) => s.document_id);
  } catch (e) {
    answer = `ERROR: ${(e as Error).message}`;
  }
  const exp: string[] = q.expected_doc_ids ?? [];
  const recall = mode === "vector" && exp.length ? exp.filter((d) => retrieved.includes(d)).length / exp.length : null;
  const ans = phraseScore(answer, q.expected_answer_contains);
  rows.push({ id: q.id, category: q.category, mode, recall, ans });
  const tag = `${mode.toUpperCase().padEnd(7)}`;
  console.log(`${(q.id || "").padEnd(4)} ${tag} ans=${ans == null ? " - " : (ans * 100).toFixed(0).padStart(3) + "%"} recall=${recall == null ? " - " : (recall * 100).toFixed(0).padStart(3) + "%"}  ${q.query.slice(0, 46)}`);
});

// ── Aggregates ──
const avg = (a: (number | null)[]) => { const v = a.filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const pctOr = (x: number | null) => x == null ? "  -" : (x * 100).toFixed(0).padStart(3) + "%";

console.log("\n──────── ROUTING ────────");
const byMode: Record<string, number> = {};
for (const r of rows) byMode[r.mode] = (byMode[r.mode] ?? 0) + 1;
for (const [m, n] of Object.entries(byMode)) console.log(`  ${m.padEnd(8)} ${n}`);

console.log("\n──────── SYSTEM CORRECTNESS (answer contains expected) ────────");
console.log(`  overall:            ${pctOr(avg(rows.map((r) => r.ans)))}`);
console.log(`  SQL/hybrid-answered: ${pctOr(avg(rows.filter((r) => r.mode !== "vector").map((r) => r.ans)))}`);
console.log(`  vector-answered:     ${pctOr(avg(rows.filter((r) => r.mode === "vector").map((r) => r.ans)))}`);
console.log(`  vector doc recall@${K}: ${pctOr(avg(rows.filter((r) => r.mode === "vector").map((r) => r.recall)))}  (vector-routed only)`);

console.log("\n──────── BY CATEGORY ────────");
const cats = [...new Set(rows.map((r) => r.category))];
console.log("  category            n   modes               ans   vec-recall");
for (const c of cats) {
  const cr = rows.filter((r) => r.category === c);
  const modes = Object.entries(cr.reduce((a: Record<string, number>, r) => (a[r.mode] = (a[r.mode] ?? 0) + 1, a), {}))
    .map(([m, n]) => `${m}:${n}`).join(" ");
  console.log(`  ${c.padEnd(19)} ${String(cr.length).padStart(2)}  ${modes.padEnd(18)} ${pctOr(avg(cr.map((r) => r.ans)))}  ${pctOr(avg(cr.filter((r) => r.mode === "vector").map((r) => r.recall)))}`);
}
