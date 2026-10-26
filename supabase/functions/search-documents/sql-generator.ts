// Text-to-SQL generator (Day 8) — turns a natural-language question + the table
// schema into a single PostgreSQL SELECT. Defaults to Haiku; the caller escalates
// to Sonnet on low router confidence (4-table joins + the bool/null gotchas
// occasionally trip Haiku).
import { callClaude, HAIKU, SONNET, parseJsonLoose } from "../_shared/anthropic.ts";

export interface GeneratedSql {
  sql: string;
  tables_used: string[];
  explanation: string;
  model: string;
}

const SYSTEM = `You write a single PostgreSQL SELECT statement that answers the user's question using ONLY the tables provided.
GOTCHAS (this dataset):
- Boolean columns are real bools (already cast on import). Filter with = TRUE / = FALSE, never the string 'True'.
- A NULL end_date means the subscription is active/current.
- A NULL satisfaction_score means unrated — exclude it from averages unless the user asks otherwise.
- churn_events may contain reactivations; COUNT(DISTINCT account_id) when computing churn.
RULES:
- Exactly one SELECT statement. No INSERT/UPDATE/DELETE/DDL, no semicolons mid-query, no writable CTEs.
- Always include LIMIT 1000.
- Reference tables by their EXACT names as written in the schema (e.g. u_<hex>_accounts).
- Use ILIKE for text filters on free-form columns (industry, country, reason_code, plan_tier).
- Output ONLY a JSON object: {"sql":"<one SELECT>","tables_used":["<table>", ...],"explanation":"<one sentence>"}.`;

export async function generateSql(
  query: string,
  schemaPrompt: string,
  apiKey: string,
  useSonnet = false,
): Promise<GeneratedSql> {
  const model = useSonnet ? SONNET : HAIKU;
  const text = await callClaude({
    apiKey,
    model,
    system: SYSTEM,
    user: `SCHEMA:\n${schemaPrompt}\n\nQUESTION: ${query}`,
    maxTokens: 700,
    temperature: 0,
    timeoutMs: 15000,
  });
  const parsed = parseJsonLoose<Omit<GeneratedSql, "model">>(text);
  if (!parsed.sql || typeof parsed.sql !== "string") {
    throw new Error("generator returned no sql");
  }
  return { ...parsed, model };
}
