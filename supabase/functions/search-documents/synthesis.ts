// Synthesis adapter (Day 9) — turns SQL result rows into a grounded natural-language
// answer. The prompt forbids inventing numbers: the model may only restate values
// present in the rows. Vector-mode synthesis stays inline in index.ts (unchanged).
import { callClaude, callClaudeStream, HAIKU } from "../_shared/anthropic.ts";

export type OnToken = (text: string) => void;

const MAX_TABLE_ROWS = 20;

const SYSTEM = `You answer a Product Manager's analytical question using ONLY the SQL result rows provided.
- State counts, sums, averages, and percentages literally from the data. Never invent or estimate a number not present in the rows.
- If there are 0 rows, say plainly that no matching data was found.
- Be concise: 2-4 sentences. Lead with the answer.`;

/** Render result rows as a compact markdown table (capped) for the prompt. */
function toMarkdownTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(no rows)";
  const cols = Object.keys(rows[0]);
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(0, MAX_TABLE_ROWS)
    .map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`)
    .join("\n");
  return [head, sep, body].join("\n");
}

export async function synthesizeSqlAnswer(
  query: string,
  rows: Record<string, unknown>[],
  rowCount: number,
  truncated: boolean,
  apiKey: string,
  onToken?: OnToken,
): Promise<string> {
  const tag = `${rowCount} row${rowCount === 1 ? "" : "s"}${truncated ? ", truncated at 1000" : ""}`;
  const user = `QUESTION: ${query}\n\nSQL RESULT (${tag}):\n${toMarkdownTable(rows)}`;
  const opts = { apiKey, model: HAIKU, system: SYSTEM, user, maxTokens: 400, temperature: 0, timeoutMs: 20000 };
  return onToken ? await callClaudeStream(opts, onToken) : await callClaude(opts);
}

const HYBRID_SYSTEM = `You answer a Product Manager's question using a SQL result (the authoritative counts/filters) PLUS verbatim customer feedback evidence.
- State the structured numbers literally from the SQL rows.
- Then characterize the feedback, quoting 2-3 short verbatim phrases from the evidence.
- Never invent numbers or quotes. Be concise: 3-5 sentences.`;

/**
 * Day 12 — hybrid answer: SQL rows for the counts/filter, plus verbatim feedback
 * snippets harvested from vector chunks whose account_id matched the SQL set.
 */
export async function synthesizeHybridAnswer(
  query: string,
  rows: Record<string, unknown>[],
  rowCount: number,
  truncated: boolean,
  evidence: string[],
  apiKey: string,
  onToken?: OnToken,
): Promise<string> {
  const tag = `${rowCount} row${rowCount === 1 ? "" : "s"}${truncated ? ", truncated at 1000" : ""}`;
  const evidenceBlock = evidence.length
    ? evidence.map((e, i) => `[${i + 1}] ${e}`).join("\n")
    : "(no separate feedback documents matched — rely on any feedback columns in the SQL rows)";
  const user =
    `QUESTION: ${query}\n\nSQL RESULT (${tag}):\n${toMarkdownTable(rows)}\n\n` +
    `CUSTOMER FEEDBACK EVIDENCE:\n${evidenceBlock}`;
  const opts = { apiKey, model: HAIKU, system: HYBRID_SYSTEM, user, maxTokens: 450, temperature: 0, timeoutMs: 20000 };
  return onToken ? await callClaudeStream(opts, onToken) : await callClaude(opts);
}
