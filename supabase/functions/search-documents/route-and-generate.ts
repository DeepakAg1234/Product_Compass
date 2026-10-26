// Combined planner (latency optimization) — one Haiku call that BOTH decides the
// retrieval mode AND writes the SQL. Replaces the separate router + generator
// calls (two sequential round-trips → one), the single biggest latency lever on
// the SQL path. Falls back to vector on any error/parse failure.
import { callClaude, HAIKU, parseJsonLoose } from "../_shared/anthropic.ts";

export interface QueryPlan {
  mode: "sql" | "vector" | "hybrid";
  sql: string;
  tables_used: string[];
  reason: string;
  confidence: number;
  model: string;
  plan_ms: number;
}

const SYSTEM = `You are a query planner for a Product Manager analytics assistant. Given the user's question and the available SQL tables, decide how to answer and, when applicable, write the query.

DECIDE THE MODE:
- "sql": the question asks for counts, rates, sums, averages, comparisons, rankings, or filters that map cleanly to the tables below.
- "hybrid": a structured filter PLUS free-text customer feedback (e.g. "customers who churned citing pricing — what did they say").
- "vector": the question is narrative/qualitative, or references documents not in the tables. For vector, return sql:"".

WHEN MODE IS sql OR hybrid, write a single PostgreSQL SELECT. GOTCHAS (this dataset):
- Boolean columns are real bools (already cast); filter with = TRUE / = FALSE, never the string 'True'.
- A NULL end_date means the subscription is active/current.
- A NULL satisfaction_score means unrated — exclude from averages unless asked.
- churn_events may contain reactivations; COUNT(DISTINCT account_id) for churn.
RULES for the SQL:
- Exactly one SELECT. No INSERT/UPDATE/DELETE/DDL, no semicolons mid-query, no writable CTEs.
- Always include LIMIT 1000.
- Reference tables by their EXACT names as written in the schema (e.g. u_<hex>_accounts).
- Use ILIKE for text filters on industry/country/reason_code/plan_tier.

Output ONLY JSON: {"mode":"sql|hybrid|vector","sql":"<one SELECT, or empty for vector>","tables_used":["<table>", ...],"reason":"<one clause>","confidence":<0.0-1.0>}.`;

export async function routeAndGenerate(
  query: string,
  schemaPrompt: string,
  apiKey: string,
): Promise<QueryPlan> {
  const t0 = performance.now();
  const fallback = (reason: string): QueryPlan => ({
    mode: "vector", sql: "", tables_used: [], reason, confidence: 0,
    model: HAIKU, plan_ms: Math.round(performance.now() - t0),
  });

  if (!schemaPrompt.trim()) return fallback("no sheet tables for user");

  try {
    const text = await callClaude({
      apiKey,
      model: HAIKU,
      system: SYSTEM,
      user: `SCHEMA:\n${schemaPrompt}\n\nQUESTION: ${query}`,
      maxTokens: 700,
      temperature: 0,
      timeoutMs: 15000,
    });
    const parsed = parseJsonLoose<Omit<QueryPlan, "model" | "plan_ms">>(text);
    if (!["sql", "vector", "hybrid"].includes(parsed.mode)) {
      return fallback(`unexpected mode: ${parsed.mode}`);
    }
    return { ...parsed, sql: parsed.sql ?? "", tables_used: parsed.tables_used ?? [], model: HAIKU, plan_ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return fallback(`planner error: ${(e as Error).message}`);
  }
}
