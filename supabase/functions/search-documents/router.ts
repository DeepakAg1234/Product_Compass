// Query router (Day 7) — a fast Haiku classifier that decides whether a question
// should be answered by SQL (exact math over the sheet tables), vector search
// (narrative/qualitative), or hybrid (structured filter + free-text feedback).
//
// Fails safe: any error, unparseable output, or low confidence falls back to
// "vector", which preserves the existing /search behavior.
import { callClaude, HAIKU, parseJsonLoose } from "../_shared/anthropic.ts";

export interface RouterDecision {
  mode: "sql" | "vector" | "hybrid";
  reason: string;
  confidence: number;
  router_ms: number;
}

const CONFIDENCE_FLOOR = 0.55;

const SYSTEM = `You classify a Product Manager's analytics query into a retrieval mode.
RULES:
- sql: the question asks for counts, rates, sums, averages, comparisons, rankings, or filters that map cleanly to the available tables/columns.
- vector: the question is about strategy, narrative, qualitative themes, or references documents not in the tables.
- hybrid: a structured filter PLUS free-text feedback (e.g. "customers who churned citing pricing — what did they actually say").
Return ONLY a JSON object: {"mode":"sql|vector|hybrid","reason":"<one short clause>","confidence":<0.0-1.0>}.`;

export async function routeQuery(
  query: string,
  registrySummary: string,
  apiKey: string,
): Promise<RouterDecision> {
  const t0 = performance.now();
  const fallback = (reason: string, confidence = 0): RouterDecision => ({
    mode: "vector",
    reason,
    confidence,
    router_ms: Math.round(performance.now() - t0),
  });

  // No materialized tables → nothing to route to SQL.
  if (!registrySummary.trim()) return fallback("no sheet tables for user", 1);

  try {
    const text = await callClaude({
      apiKey,
      model: HAIKU,
      system: SYSTEM,
      user: `TABLES AVAILABLE: ${registrySummary}\n\nQUERY: ${query}`,
      maxTokens: 150,
      temperature: 0,
      timeoutMs: 8000,
    });
    const parsed = parseJsonLoose<Omit<RouterDecision, "router_ms">>(text);

    if (!["sql", "vector", "hybrid"].includes(parsed.mode)) {
      return fallback(`unexpected mode: ${parsed.mode}`);
    }
    // Low confidence → preserve current semantics by falling back to vector.
    if (typeof parsed.confidence !== "number" || parsed.confidence < CONFIDENCE_FLOOR) {
      return fallback(parsed.reason ?? "low confidence", parsed.confidence ?? 0);
    }
    return { ...parsed, router_ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return fallback(`router error: ${(e as Error).message}`);
  }
}
