// Text-to-SQL materialization — pure functions (Day 2).
// CSV parsing + header sanitization + column type inference. No DB, no network,
// no side effects: everything here is unit-testable in isolation. The DB writer
// (materializeCsvAsTable, registry upsert) is the Day 3 section at the bottom.
//
// `import type` is erased at runtime, so importing the pure functions for tests
// does NOT pull in the postgres driver.
import type { PgClient } from "../_shared/pg-client.ts";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export interface ColType {
  sql: string;       // postgres type: bool|int4|int8|numeric|date|timestamp|text
  nullable: boolean; // true if any sampled value was empty
}

/**
 * RFC4180-compliant CSV parser. Handles quoted fields, escaped quotes (""),
 * commas and newlines inside quotes, CRLF/LF line endings, and a leading BOM.
 *
 * Returns the header row separately from data rows. Fully-blank trailing lines
 * (the artifact of a trailing newline) are dropped; ragged rows are returned
 * as-is — the Day 3 writer is responsible for padding/validating against the
 * header width.
 */
export function parseCsv(input: string): ParsedCsv {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = input.length;

  if (n > 0 && input.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    records.push(record);
    record = [];
  };

  while (i < n) {
    const c = input[i];

    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      endField();
      i++;
    } else if (c === "\r") {
      endField();
      endRecord();
      i += input[i + 1] === "\n" ? 2 : 1; // CRLF or lone CR
    } else if (c === "\n") {
      endField();
      endRecord();
      i++;
    } else {
      field += c;
      i++;
    }
  }

  // Flush any trailing field/record not terminated by a newline.
  if (field.length > 0 || record.length > 0) {
    endField();
    endRecord();
  }

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0];
  // Drop blank lines (every field empty) — typically the trailing newline.
  const rows = records.slice(1).filter((r) => !r.every((f) => f === ""));
  return { headers, rows };
}

/**
 * Sanitize raw CSV headers into safe, unique Postgres column names:
 * lowercased, non-alphanumerics collapsed to `_`, trimmed, digit-leading names
 * prefixed with `_`, empty names → `col`, and duplicates deterministically
 * suffixed `_2`, `_3`, … (first occurrence keeps the bare name).
 */
export function sanitizeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h) => {
    let s = h
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (s === "") s = "col";
    if (/^[0-9]/.test(s)) s = "_" + s;

    const count = seen.get(s) ?? 0;
    seen.set(s, count + 1);
    return count === 0 ? s : `${s}_${count + 1}`;
  });
}

const BOOL_VALUES = new Set(["true", "false"]);
const INT_RE = /^-?\d+$/;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;

/**
 * Infer a Postgres column type from a sample of raw string cell values.
 * First match wins, over the NON-EMPTY values only. An empty string is treated
 * as NULL (and sets `nullable`).
 *
 * Deviations from the original plan, both deliberate:
 *  - bool is True/False-family ONLY (not 0/1) — see note in the .ts header / PR.
 *    Prevents 0/1-only integer columns from being mistyped as boolean.
 *  - the ">50% null → numeric" stabilizer is scoped to the numeric family, so a
 *    sparse text column stays text rather than being forced to numeric.
 */
export function inferType(values: string[]): ColType {
  const nonEmpty = values.filter((v) => v !== "" && v != null);
  const nullable = nonEmpty.length < values.length;

  // No signal to infer from — text accepts anything a later sync might bring.
  if (nonEmpty.length === 0) return { sql: "text", nullable: true };

  const all = (pred: (v: string) => boolean) => nonEmpty.every(pred);

  // 1. boolean
  if (all((v) => BOOL_VALUES.has(v.toLowerCase()))) {
    return { sql: "bool", nullable };
  }

  // 2 & 3. integer / numeric
  if (all((v) => NUMERIC_RE.test(v))) {
    const anyDecimal = nonEmpty.some((v) => v.includes("."));
    const nullRate = (values.length - nonEmpty.length) / values.length;
    // Promote to numeric on any decimal OR sparsity, to avoid an int4↔numeric
    // type flip across re-syncs when a later sample happens to differ.
    if (anyDecimal || nullRate > 0.5) return { sql: "numeric", nullable };

    const fitsInt4 = all((v) => {
      const num = Number(v);
      return INT_RE.test(v) && num >= INT4_MIN && num <= INT4_MAX;
    });
    return { sql: fitsInt4 ? "int4" : "int8", nullable };
  }

  // 4. date (anchored — a value with a time component won't match)
  if (all((v) => DATE_RE.test(v))) return { sql: "date", nullable };

  // 5. timestamp
  if (all((v) => TIMESTAMP_RE.test(v))) return { sql: "timestamp", nullable };

  // 6. text
  return { sql: "text", nullable };
}

// ════════════════════════════ Day 3: DB writer ════════════════════════════
// Everything below performs side effects (DDL + INSERT + registry upsert) via a
// postgres.js client. RLS templating + per-table grants are deliberately left
// for Day 4 — Day 3 just gets typed data into the sheets schema.

export interface DriveFile {
  id: string;
  title: string;
}

export interface MaterializeResult {
  tableName: string;
  rowCount: number;
}

/** Quote a Postgres identifier (our sanitized names are already safe; belt-and-suspenders). */
export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function slugify(s: string): string {
  const out = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return out === "" ? "sheet" : out;
}

/**
 * Deterministic per-user table name: `u_<uid-hex>_<slug>[_<sheet>]`, clamped to
 * Postgres's 63-byte identifier limit (the slug is trimmed, never the uid — the
 * uid is what guarantees per-user uniqueness).
 */
export function nameTable(userId: string, title: string, sheetName = "_default"): string {
  const uid = userId.replace(/-/g, "").toLowerCase();
  const sheetPart = sheetName && sheetName !== "_default" ? "_" + slugify(sheetName) : "";
  const prefix = `u_${uid}_`;
  const maxSlug = Math.max(1, 63 - prefix.length - sheetPart.length);
  return `${prefix}${slugify(title).slice(0, maxSlug)}${sheetPart}`;
}

/** Build the CREATE TABLE statement for the inferred schema. */
export function buildCreateTable(tableName: string, headers: string[], colTypes: ColType[]): string {
  const cols = headers.map((h, i) => `${quoteIdent(h)} ${colTypes[i].sql}`).join(", ");
  return `CREATE TABLE sheets.${quoteIdent(tableName)} (${cols})`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the Row Level Security block for one per-user mirror table.
 *
 * ENABLE turns RLS on; FORCE makes it apply even to the table owner (without it,
 * the service role that created the table would bypass every policy). The policy
 * grants SELECT to the read-only `sheets_reader` role only when the per-request
 * GUC `request.user_id` (set by execute_sheet_sql) equals this table's owner uid
 * — so a query that swaps into sheets_reader can only ever see its own user's
 * rows. `current_setting(..., true)` returns NULL when unset → default-deny.
 *
 * The uid is validated as a UUID before being embedded as a literal (it comes
 * from auth.users, but this is belt-and-suspenders against any injection).
 */
export function buildRlsBlock(tableName: string, userId: string): string {
  if (!UUID_RE.test(userId)) throw new Error(`refusing to build RLS for non-UUID user id: ${userId}`);
  const t = `sheets.${quoteIdent(tableName)}`;
  return `
    ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
    CREATE POLICY rls_user ON ${t}
      FOR SELECT TO sheets_reader
      USING (current_setting('request.user_id', true) = '${userId}');
    GRANT SELECT ON ${t} TO sheets_reader;
  `;
}

/**
 * Convert a raw CSV string cell into the JS value to bind for its column type.
 * Empty string → NULL. Numerics are kept as strings to preserve exact precision
 * (postgres casts them); booleans and integers become real JS primitives.
 */
export function coerceValue(raw: string, sqlType: string): string | number | boolean | null {
  if (raw === "" || raw == null) return null;
  switch (sqlType) {
    case "bool":
      return /^true$/i.test(raw);
    case "int4":
    case "int8":
      return parseInt(raw, 10);
    case "numeric":
      return raw; // keep string → exact numeric, no float drift
    default:
      return raw; // date / timestamp / text
  }
}

/** SHA-256 hex digest via Web Crypto (native in Deno, no import). */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** First N distinct non-empty values of a column — fed into the SQL-gen prompt later. */
function sampleValues(rows: string[][], colIndex: number, n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[colIndex];
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
      if (out.length >= n) break;
    }
  }
  return out;
}

// For low-cardinality columns (status, priority, project, tier, …) the SQL
// generator needs the COMPLETE set of values to filter exactly ("in progress" →
// 'In Progress'); 3 random samples miss the relevant one. Returns the full
// distinct set + isEnum=true when distinct count ≤ ENUM_MAX, else 3 samples.
const ENUM_MAX = 25;
function columnValueHints(rows: string[][], colIndex: number): { values: string[]; isEnum: boolean } {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[colIndex];
    if (v) seen.add(v);
    if (seen.size > ENUM_MAX) return { values: sampleValues(rows, colIndex, 3), isEnum: false };
  }
  if (seen.size === 0) return { values: [], isEnum: false };
  return { values: [...seen].sort(), isEnum: true };
}

async function insertAll(
  tx: PgClient,
  tableName: string,
  headers: string[],
  colTypes: ColType[],
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  const colList = headers.map(quoteIdent).join(", ");
  const CHUNK = 1000;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const batch = rows.slice(start, start + CHUNK);
    const params: (string | number | boolean | null)[] = [];
    const tuples = batch.map((row) => {
      const placeholders = headers.map((_, c) => {
        params.push(coerceValue(row[c] ?? "", colTypes[c].sql));
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await tx.unsafe(
      `INSERT INTO sheets.${quoteIdent(tableName)} (${colList}) VALUES ${tuples.join(", ")}`,
      params,
    );
  }
}

async function upsertRegistry(sql: PgClient, r: {
  userId: string;
  documentId: string;
  documentTitle: string;
  sheetName: string;
  tableName: string;
  columns: unknown[];
  sourceHeaders: string[];
  headerHash: string;
  schemaHash: string;
  contentHash: string;
  rowCount: number;
}): Promise<void> {
  await sql.unsafe(
    `INSERT INTO public.sheet_registry
       (user_id, document_id, document_title, sheet_name, table_name, schema_name,
        columns, source_headers, header_hash, schema_hash, content_hash, row_count, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,'sheets',$6::jsonb,$7::text[],$8,$9,$10,$11, now())
     ON CONFLICT (user_id, document_id, sheet_name) DO UPDATE SET
       document_title = EXCLUDED.document_title,
       table_name     = EXCLUDED.table_name,
       columns        = EXCLUDED.columns,
       source_headers = EXCLUDED.source_headers,
       header_hash    = EXCLUDED.header_hash,
       schema_hash    = EXCLUDED.schema_hash,
       content_hash   = EXCLUDED.content_hash,
       row_count      = EXCLUDED.row_count,
       last_synced_at = now()`,
    [
      r.userId, r.documentId, r.documentTitle, r.sheetName, r.tableName,
      // sql.json() — postgres.js infers wire encoding from JS type, so a
      // pre-stringified string would be JSON-encoded a 2nd time (stored as a
      // jsonb scalar string, not an array). sql.json() forces single encoding.
      // Cast: columns is plain JSON data; the `unknown[]` element type just
      // isn't structurally inferred as postgres.js's JSONValue.
      sql.json(r.columns as unknown as Parameters<typeof sql.json>[0]), r.sourceHeaders,
      r.headerHash, r.schemaHash, r.contentHash, r.rowCount,
    ],
  );
}

/**
 * Materialize one CSV as a typed Postgres table in the sheets schema and record
 * it in sheet_registry. Idempotent: re-running drops and rebuilds the table.
 * (Day 5 will replace the blunt drop+rebuild with the hash-driven resync state
 * machine; RLS + grants arrive Day 4.)
 */
export async function materializeCsvAsTable(
  sql: PgClient,
  userId: string,
  file: DriveFile,
  rawCsv: string,
  sheetName = "_default",
): Promise<MaterializeResult> {
  const { headers: rawHeaders, rows } = parseCsv(rawCsv);
  const headers = sanitizeHeaders(rawHeaders);
  // Full-column inference (see header note): correct over a sparse sample.
  const colTypes = headers.map((_, i) => inferType(rows.map((r) => r[i] ?? "")));
  const tableName = nameTable(userId, file.title, sheetName);

  const [headerHash, schemaHash, contentHash] = await Promise.all([
    sha256(rawHeaders.join("|")),
    sha256(JSON.stringify(headers.map((h, i) => [h, colTypes[i].sql]))),
    sha256(rawCsv),
  ]);

  await sql.begin(async (tx: PgClient) => {
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS sheets`);
    await tx.unsafe(`DROP TABLE IF EXISTS sheets.${quoteIdent(tableName)} CASCADE`);
    await tx.unsafe(buildCreateTable(tableName, headers, colTypes));
    await insertAll(tx, tableName, headers, colTypes, rows);
    // Day 4: lock the table down — RLS + read-only grant — before commit.
    await tx.unsafe(buildRlsBlock(tableName, userId));
  });

  const columns = headers.map((h, i) => {
    const hint = columnValueHints(rows, i);
    return {
      name: h,
      type: colTypes[i].sql,
      nullable: colTypes[i].nullable,
      sample_values: hint.values,
      ...(hint.isEnum ? { enum: true } : {}),
    };
  });

  await upsertRegistry(sql, {
    userId,
    documentId: file.id,
    documentTitle: file.title,
    sheetName,
    tableName,
    columns,
    sourceHeaders: rawHeaders,
    headerHash,
    schemaHash,
    contentHash,
    rowCount: rows.length,
  });

  return { tableName, rowCount: rows.length };
}
