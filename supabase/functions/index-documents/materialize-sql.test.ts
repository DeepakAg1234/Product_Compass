// Day 2 DoD tests. Run from repo root:
//   deno test --allow-read supabase/functions/index-documents/materialize-sql.test.ts
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCreateTable,
  type ColType,
  coerceValue,
  inferType,
  nameTable,
  parseCsv,
  quoteIdent,
  sanitizeHeaders,
  sha256,
} from "./materialize-sql.ts";

// Real RavenStack CSVs (resolved relative to this module, not the CWD).
const DATA = new URL("../../../evals/data/ravenstack/", import.meta.url);
const cache = new Map<string, ReturnType<typeof parseCsv>>();
function loadCsv(file: string) {
  if (!cache.has(file)) {
    cache.set(file, parseCsv(Deno.readTextFileSync(new URL(file, DATA))));
  }
  return cache.get(file)!;
}
/** Infer the type of one named column from a real CSV. */
function inferColumn(file: string, column: string): ColType {
  const { headers, rows } = loadCsv(file);
  const idx = headers.indexOf(column);
  assert(idx >= 0, `column ${column} not found in ${file}`);
  return inferType(rows.map((r) => r[idx]));
}

// ─────────────────────────── parseCsv: RFC4180 ───────────────────────────
// The real RavenStack data has no quoted fields, so these synthetic fixtures
// are what actually exercise the quoting state machine (the DoD's headline).

Deno.test("parseCsv: quoted comma is one cell, not a delimiter", () => {
  const { headers, rows } = parseCsv('a,b,c\n1,"hello, world",3\n');
  assertEquals(headers, ["a", "b", "c"]);
  assertEquals(rows, [["1", "hello, world", "3"]]);
});

Deno.test("parseCsv: escaped quotes inside a quoted field", () => {
  const { rows } = parseCsv('x\n"she said ""hi"""\n');
  assertEquals(rows, [['she said "hi"']]);
});

Deno.test("parseCsv: newline inside a quoted field stays in the cell", () => {
  const { rows } = parseCsv('id,note\n1,"line1\nline2"\n');
  assertEquals(rows, [["1", "line1\nline2"]]);
});

Deno.test("parseCsv: CRLF line endings and trailing newline", () => {
  const { headers, rows } = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
  assertEquals(headers, ["a", "b"]);
  assertEquals(rows, [["1", "2"], ["3", "4"]]);
});

Deno.test("parseCsv: empty trailing field preserved, blank lines dropped", () => {
  const { rows } = parseCsv("a,b,c\n1,,3\n\n");
  assertEquals(rows, [["1", "", "3"]]);
});

Deno.test("parseCsv: real accounts.csv shape", () => {
  const { headers, rows } = loadCsv("ravenstack_accounts.csv");
  assertEquals(headers.length, 10);
  assertEquals(headers[0], "account_id");
  assertEquals(rows.length, 500);
});

// ─────────────────────────── sanitizeHeaders ───────────────────────────

Deno.test("sanitizeHeaders: snake_case, trim, digit-prefix, dedup", () => {
  assertEquals(
    sanitizeHeaders(["Account ID", "MRR ($)", "2024", "", "name", "name"]),
    ["account_id", "mrr", "_2024", "col", "name", "name_2"],
  );
});

// ─────────────────────────── inferType: real columns ───────────────────────────

Deno.test("inferType: True/False string columns → bool", () => {
  assertEquals(inferColumn("ravenstack_accounts.csv", "is_trial").sql, "bool");
  assertEquals(inferColumn("ravenstack_accounts.csv", "churn_flag").sql, "bool");
  assertEquals(inferColumn("ravenstack_support_tickets.csv", "escalation_flag").sql, "bool");
});

Deno.test("inferType: date columns (pure YYYY-MM-DD)", () => {
  assertEquals(inferColumn("ravenstack_accounts.csv", "signup_date").sql, "date");
  assertEquals(inferColumn("ravenstack_support_tickets.csv", "submitted_at").sql, "date");
});

Deno.test("inferType: subscriptions.end_date → date, nullable (active = NULL)", () => {
  const t = inferColumn("ravenstack_subscriptions.csv", "end_date");
  assertEquals(t.sql, "date");
  assertEquals(t.nullable, true);
});

Deno.test("inferType: timestamp column with time component", () => {
  const t = inferColumn("ravenstack_support_tickets.csv", "closed_at");
  assertEquals(t.sql, "timestamp");
  // NOTE: closed_at is populated in all 2000 rows in this dataset (never NULL).
  // This breaks eval sql-08's premise ("open tickets" = closed_at IS NULL → 0).
  // Flagged for Day 14 — the eval needs a different "open" signal or removal.
  assertEquals(t.nullable, false);
});

Deno.test("inferType: integer columns → int4", () => {
  assertEquals(inferColumn("ravenstack_accounts.csv", "seats").sql, "int4");
  assertEquals(inferColumn("ravenstack_subscriptions.csv", "mrr_amount").sql, "int4");
  assertEquals(inferColumn("ravenstack_feature_usage.csv", "usage_count").sql, "int4");
});

Deno.test("inferType: decimal column → numeric", () => {
  assertEquals(inferColumn("ravenstack_churn_events.csv", "refund_amount_usd").sql, "numeric");
});

Deno.test("inferType: satisfaction_score → numeric, nullable (3.0/4.0/5.0, ~41% null)", () => {
  const t = inferColumn("ravenstack_support_tickets.csv", "satisfaction_score");
  assertEquals(t.sql, "numeric");
  assertEquals(t.nullable, true);
});

Deno.test("inferType: free-text columns → text", () => {
  assertEquals(inferColumn("ravenstack_accounts.csv", "industry").sql, "text");
  const feedback = inferColumn("ravenstack_churn_events.csv", "feedback_text");
  assertEquals(feedback.sql, "text");
  assertEquals(feedback.nullable, true);
});

// HAZARD regression: error_count contains 0s and 1s but must NOT become bool.
Deno.test("inferType: 0/1-containing integer column stays int4, not bool", () => {
  assertEquals(inferColumn("ravenstack_feature_usage.csv", "error_count").sql, "int4");
  // And the synthetic worst case: a column that is ONLY 0s and 1s.
  assertEquals(inferType(["0", "1", "1", "0", "1"]).sql, "int4");
});

// ─────────────────────────── Day 3: writer helpers (no DB) ───────────────────────────

Deno.test("nameTable: per-user prefix, slugified title, within 63 bytes", () => {
  const uid = "11111111-2222-3333-4444-555555555555";
  const t = nameTable(uid, "ravenstack_accounts");
  assertEquals(t, "u_11111111222233334444555555555555_ravenstack_accounts");
  assert(t.length <= 63, `table name too long: ${t.length}`);
  // Long titles get the slug trimmed, never the uid.
  const long = nameTable(uid, "a".repeat(100));
  assert(long.length <= 63);
  assert(long.startsWith("u_11111111222233334444555555555555_"));
});

Deno.test("buildCreateTable: quoted identifiers + inferred types", () => {
  const sql = buildCreateTable(
    "u_abc_accounts",
    ["account_id", "seats", "is_trial"],
    [{ sql: "text", nullable: false }, { sql: "int4", nullable: false }, { sql: "bool", nullable: false }],
  );
  assertEquals(
    sql,
    'CREATE TABLE sheets."u_abc_accounts" ("account_id" text, "seats" int4, "is_trial" bool)',
  );
});

Deno.test("quoteIdent: escapes embedded double-quotes", () => {
  assertEquals(quoteIdent('a"b'), '"a""b"');
});

Deno.test("coerceValue: type-correct binding values", () => {
  assertEquals(coerceValue("", "text"), null);          // empty → NULL
  assertEquals(coerceValue("True", "bool"), true);
  assertEquals(coerceValue("False", "bool"), false);
  assertEquals(coerceValue("9", "int4"), 9);            // real number
  assertEquals(coerceValue("4.03", "numeric"), "4.03"); // string → exact precision
  assertEquals(coerceValue("2025-10-16", "date"), "2025-10-16");
});

Deno.test("sha256: known digest", async () => {
  assertEquals(
    await sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
