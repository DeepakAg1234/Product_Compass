// Text-to-SQL orchestration (Day 10) — ties router → generator → executor →
// synthesis into one call for /search. Returns a full response object when it
// handled the query, or null to tell the caller "fall back to the vector path".
//
// It owns its own Postgres connection (created lazily, closed in finally) so the
// vector path pays nothing when the router picks vector.
import { createPgClient } from "../_shared/pg-client.ts";
import { type RegistryRow, buildSchemaPrompt } from "./registry.ts";
import { routeAndGenerate } from "./route-and-generate.ts";
import { runSql } from "./sql-executor.ts";
import { synthesizeHybridAnswer, synthesizeSqlAnswer } from "./synthesis.ts";

/** A vector chunk carrying the account_ids it covers (from metadata). */
export interface VectorChunk { chunk_text: string; account_ids: string[] }
/** Caller-supplied vector search (embed + match_documents), used only for hybrid. */
export type VectorSearchFn = (query: string) => Promise<VectorChunk[]>;

/** Collect account_id values from SQL result rows (any column literally named account_id). */
function accountIdsFromRows(rows: Record<string, unknown>[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const v = r["account_id"];
    if (typeof v === "string" && v) out.add(v);
  }
  return out;
}

export interface SqlPathResult {
  answer: string;
  sources: unknown[];
  query: string;
  trace: {
    mode: string;
    router_reason: string;
    router_confidence: number;
    sql?: string;
    tables_used?: string[];
    row_count?: number;
    truncated?: boolean;
    model?: string;
    exec_ms?: number;
    evidence_chunks?: number;
  };
}

export interface SqlPathHooks {
  onStep?: (step: string) => void;
  onToken?: (text: string) => void;
}

export async function runSqlPath(
  query: string,
  userId: string,
  registryRows: RegistryRow[],
  anthropicKey: string,
  enableHybrid: boolean,
  vectorSearch?: VectorSearchFn,
  hooks: SqlPathHooks = {},
): Promise<SqlPathResult | null> {
  if (!registryRows.length) return null; // no tables → vector
  const step = (s: string) => hooks.onStep?.(s);

  const allowed = registryRows.map((r) => r.table_name);
  const schema = buildSchemaPrompt(registryRows);

  // One Haiku call decides the mode AND writes the SQL (was two sequential calls).
  step("generating_sql");
  const plan = await routeAndGenerate(query, schema, anthropicKey);
  const decision = plan; // same shape (mode/reason/confidence)

  // vector, hybrid-while-disabled, or no SQL produced → fall back to vector.
  if (plan.mode === "vector") return null;
  if (plan.mode === "hybrid" && !enableHybrid) return null;
  if (!plan.sql) return null;

  const pg = createPgClient();
  try {
    step("executing");
    const exec = await runSql(pg, userId, plan.sql, allowed);

    // Executor rejected or DB errored → fall back to vector rather than show
    // the user an empty/confusing result.
    if (exec.error) {
      console.error(`SQL path error (${plan.model}): ${exec.error} | sql: ${plan.sql}`);
      return null;
    }

    const rows = exec.rows ?? [];
    let answer: string;
    let evidenceCount = 0;

    if (decision.mode === "hybrid") {
      // Day 12: reconcile SQL account_ids with vector chunks that carry matching
      // account_id metadata; fold those feedback snippets into the answer.
      // Additive — if no chunks match (e.g. feedback lives only in a SQL column),
      // it degrades to a feedback-aware SQL summary.
      const sqlIds = accountIdsFromRows(rows);
      let evidence: string[] = [];
      if (vectorSearch && sqlIds.size > 0) {
        step("matching_feedback");
        try {
          const chunks = await vectorSearch(query);
          evidence = chunks
            .filter((c) => c.account_ids?.some((id) => sqlIds.has(id)))
            .slice(0, 7)
            .map((c) => c.chunk_text);
          evidenceCount = evidence.length;
        } catch (e) {
          console.error(`hybrid vector search failed (continuing SQL-only): ${(e as Error).message}`);
        }
      }
      step("synthesizing");
      answer = await synthesizeHybridAnswer(
        query, rows, exec.row_count ?? 0, exec.truncated ?? false, evidence, anthropicKey, hooks.onToken,
      );
    } else {
      step("synthesizing");
      answer = await synthesizeSqlAnswer(
        query, rows, exec.row_count ?? 0, exec.truncated ?? false, anthropicKey, hooks.onToken,
      );
    }

    return {
      answer,
      sources: [],
      query,
      trace: {
        mode: decision.mode,
        router_reason: decision.reason,
        router_confidence: decision.confidence,
        sql: exec.sql_executed,
        tables_used: plan.tables_used,
        row_count: exec.row_count,
        truncated: exec.truncated,
        model: plan.model,
        exec_ms: exec.elapsed_ms,
        evidence_chunks: evidenceCount,
      },
    };
  } catch (e) {
    console.error(`SQL path threw, falling back to vector: ${(e as Error).message}`);
    return null;
  } finally {
    await pg.end();
  }
}
