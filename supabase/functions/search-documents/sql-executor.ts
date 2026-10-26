// Text-to-SQL executor (Day 6) — the safety gate between LLM-authored SQL and
// the database. Five independent layers of defense, any one of which blocks harm:
//
//   1. sheets_reader role        — Postgres denies writes/DDL          (in execute_sheet_sql)
//   2. AST allowlist             — only a single SELECT; no banned     (THIS FILE: validateAndRewrite)
//                                  functions, foreign schemas, or
//                                  off-registry tables
//   3. statement/lock timeouts   — kills slow or lock-holding queries  (in execute_sheet_sql)
//   4. LIMIT injection (AST)     — caps result size, rewrite not append (THIS FILE)
//   5. search_path = sheets      — schema-less refs can't reach public (in execute_sheet_sql)
//
// Layers 1/3/5 live in the SECURITY DEFINER function public.execute_sheet_sql
// (see migration 20260606120001). This file owns layers 2 and 4, then calls that
// function. It NEVER throws to the caller — failures come back as { error }.
import pgParser from "https://esm.sh/pgsql-ast-parser@12.0.1";
import type { PgClient } from "../_shared/pg-client.ts";

const { parse, astVisitor, toSql } = pgParser;

export const MAX_ROWS = 1000;

// Functions that read the filesystem, reach the network, hold locks, sleep, or
// mutate session state. None are needed for analytics; all are blocked outright.
const BLOCKED_FUNCTIONS = new Set([
  "pg_sleep", "pg_sleep_for", "pg_sleep_until",
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file",
  "pg_relation_filepath", "lo_import", "lo_export", "lo_get", "lo_put",
  "dblink", "dblink_exec", "dblink_connect",
  "query_to_xml", "set_config",
  "pg_terminate_backend", "pg_cancel_backend", "pg_logical_emit_message",
  "pg_advisory_lock", "pg_advisory_xact_lock",
]);

// Only the sheets schema (or unqualified, which search_path pins to sheets) is
// allowed. Any other schema reference — auth, storage, pg_catalog, public — is
// an exfiltration attempt.
const ALLOWED_SCHEMA = "sheets";

export interface ExecutorResult {
  rows?: Record<string, unknown>[];
  row_count?: number;
  truncated?: boolean;
  elapsed_ms?: number;
  sql_executed?: string;
  error?: string;
}

type ValidateResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

/**
 * Layers 2 + 4 — parse, allowlist-check, and LIMIT-rewrite an LLM-authored query.
 * Pure function (no DB), so it's unit-testable. Returns the rewritten SQL to run,
 * or a rejection reason. `allowedTables` is the user's registry table names.
 */
export function validateAndRewrite(rawSql: string, allowedTables: string[]): ValidateResult {
  let statements;
  try {
    statements = parse(rawSql);
  } catch (e) {
    return { ok: false, reason: `parse error: ${(e as Error).message}` };
  }

  if (statements.length !== 1) {
    return { ok: false, reason: `exactly one statement allowed (got ${statements.length})` };
  }

  // A bare SELECT parses as 'select'; a CTE query (WITH … SELECT) parses as
  // 'with' whose `.in` is the final select. Allow both; reject everything else
  // (insert/update/delete/drop/etc. all have their own top-level type).
  const top = statements[0];
  const cteNames = new Set<string>();
  let root = top;
  if (top.type === "with") {
    for (const b of top.bind) cteNames.add(b.alias.name.toLowerCase());
    root = top.in;
  }
  if (root.type !== "select") {
    return { ok: false, reason: `only SELECT is permitted (got ${top.type})` };
  }

  const allowed = new Set(allowedTables.map((t) => t.toLowerCase()));
  let violation: string | null = null;
  const flag = (msg: string) => { if (!violation) violation = msg; };

  const visitor = astVisitor((map) => ({
    call: (c) => {
      const fn = (c.function?.name ?? "").toLowerCase();
      if (BLOCKED_FUNCTIONS.has(fn)) flag(`blocked function: ${fn}()`);
      map.super().call(c);
    },
    tableRef: (t) => {
      const schema = (t.schema ?? "").toLowerCase();
      if (schema && schema !== ALLOWED_SCHEMA) {
        flag(`foreign schema not allowed: ${schema}.${t.name}`);
      } else {
        const name = (t.name ?? "").toLowerCase();
        if (!allowed.has(name) && !cteNames.has(name)) {
          flag(`table not in your registry: ${t.name}`);
        }
      }
      map.super().tableRef(t);
    },
  }));
  visitor.statement(top);
  if (violation) return { ok: false, reason: violation };

  // Layer 4 — enforce a row cap by rewriting the AST (not string-appending,
  // which would break UNION shapes and collide with an existing LIMIT).
  const existing = root.limit?.limit;
  const existingVal = existing && existing.type === "integer" ? existing.value : null;
  if (existingVal == null || existingVal > MAX_ROWS) {
    root.limit = { ...(root.limit ?? {}), limit: { type: "integer", value: MAX_ROWS } };
  }

  return { ok: true, sql: toSql.statement(top) };
}

/**
 * Full execution: validate + rewrite (layers 2/4), then run the query inside a
 * READ ONLY transaction that swaps into sheets_reader, sets the per-user GUC for
 * RLS, and applies timeouts + search_path (layers 1/3/5).
 *
 * The role swap is done here, in a plain transaction, rather than in a
 * SECURITY DEFINER function — Postgres forbids SET ROLE inside SECURITY DEFINER.
 * SET LOCAL is transaction-scoped, so the role/timeouts auto-revert on commit.
 * GUC and timeouts are set as the service role first, role is swapped LAST.
 *
 * Never throws — a rejected query or a DB error both come back as { error }.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runSql(
  pg: PgClient,
  userId: string,
  rawSql: string,
  allowedTables: string[],
): Promise<ExecutorResult> {
  // userId is inlined into the setup batch below, so it must be a real UUID.
  if (!UUID_RE.test(userId)) return { error: "invalid user id", sql_executed: rawSql };

  const check = validateAndRewrite(rawSql, allowedTables);
  if (!check.ok) return { error: check.reason, sql_executed: rawSql };

  const t0 = performance.now();
  try {
    let rows: Record<string, unknown>[] = [];
    await pg.begin(async (tx: PgClient) => {
      // All session setup in ONE round-trip (was 7 separate trips). SET ROLE is
      // last so the GUC + timeouts are set as the privileged role first. userId
      // is inlined (UUID-validated above) because multi-statement batches can't
      // bind parameters.
      await tx.unsafe(
        `SET TRANSACTION READ ONLY;` +
        `SET LOCAL statement_timeout = '5s';` +
        `SET LOCAL lock_timeout = '1s';` +
        `SET LOCAL idle_in_transaction_session_timeout = '5s';` +
        `SET LOCAL search_path = sheets;` +
        `SELECT set_config('request.user_id', '${userId}', true);` +
        `SET LOCAL ROLE sheets_reader;`,
      );
      rows = (await tx.unsafe(check.sql)) as unknown as Record<string, unknown>[];
    });
    return {
      rows,
      row_count: rows.length,
      truncated: rows.length >= MAX_ROWS,
      elapsed_ms: Math.round(performance.now() - t0),
      sql_executed: check.sql,
    };
  } catch (e) {
    return {
      error: (e as Error).message,
      sql_executed: check.sql,
      elapsed_ms: Math.round(performance.now() - t0),
    };
  }
}
