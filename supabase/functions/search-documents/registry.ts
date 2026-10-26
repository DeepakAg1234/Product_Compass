// Shared helpers for turning sheet_registry rows into prompt context for the
// router (a terse table summary) and the SQL generator (a schema with sample
// values — the single biggest quality lever per the build plan §7).

export interface RegistryColumn {
  name: string;
  type: string;
  nullable: boolean;
  sample_values: string[];
  enum?: boolean; // true when sample_values is the COMPLETE set of distinct values
}

export interface RegistryRow {
  table_name: string;
  document_title: string;
  row_count: number;
  columns: RegistryColumn[];
}

/**
 * Terse one-line-per-table summary for the router prompt, e.g.
 * `accounts(500 rows: account_id, industry, plan_tier, …); churn_events(600 rows: …)`.
 * Uses friendly document titles — the router only needs to know what exists.
 */
export function buildRegistrySummary(rows: RegistryRow[]): string {
  return rows
    .map((r) => {
      const cols = r.columns.map((c) => c.name).slice(0, 8).join(", ");
      const more = r.columns.length > 8 ? ", …" : "";
      return `${r.document_title}(${r.row_count} rows: ${cols}${more})`;
    })
    .join("; ");
}

/**
 * Full schema for the SQL generator: real (queryable) table names, each column's
 * type, and up to 3 sample values per column. Sample values are what get string
 * filters right (industry = 'FinTech', not 'fintech').
 */
export function buildSchemaPrompt(rows: RegistryRow[]): string {
  return rows
    .map((r) => {
      const cols = r.columns
        .map((c) => {
          // Enum columns: show the COMPLETE value set so filters match exactly.
          // Others: 3 samples (enough to fix casing/format).
          const samples = c.sample_values?.length
            ? (c.enum
              ? `  one of: ${c.sample_values.join(", ")}`
              : `  e.g. ${c.sample_values.slice(0, 3).join(", ")}`)
            : "";
          const nullable = c.nullable ? " (nullable)" : "";
          return `  ${c.name} ${c.type}${nullable}${samples}`;
        })
        .join("\n");
      return `TABLE ${r.table_name}  -- "${r.document_title}", ${r.row_count} rows\n${cols}`;
    })
    .join("\n\n");
}
