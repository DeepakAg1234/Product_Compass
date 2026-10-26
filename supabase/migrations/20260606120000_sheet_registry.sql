-- Text-to-SQL: catalog of materialized Google Sheets / CSVs per user.
-- Single source of truth for which mirror tables exist, their schema, and
-- resync state (driven by the three hashes). Read by the router and SQL
-- generator to build schema-priming prompts; written by the materializer.

CREATE SCHEMA IF NOT EXISTS sheets;

CREATE TABLE public.sheet_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id     text NOT NULL,
  document_title  text NOT NULL,
  sheet_name      text NOT NULL DEFAULT '_default',
  table_name      text NOT NULL,                  -- qualified as sheets.<table_name>
  schema_name     text NOT NULL DEFAULT 'sheets',
  columns         jsonb NOT NULL,                 -- [{name,type,nullable,sample_values:[3]}]
  source_headers  text[] NOT NULL,                -- raw, pre-sanitize
  header_hash     text NOT NULL,                  -- sha256(sorted source_headers)
  schema_hash     text NOT NULL,                  -- sha256(columns sans samples)
  content_hash    text,                           -- sha256(raw CSV bytes); for resync diff
  row_count       int4 NOT NULL DEFAULT 0,
  semantic_hints  jsonb,                          -- {table_description, column_descriptions}
  sql_enabled     bool NOT NULL DEFAULT true,     -- per-table disable for SQL routing
  indexed_at      timestamptz NOT NULL DEFAULT now(),
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_id, sheet_name),
  UNIQUE (table_name)
);

CREATE INDEX sheet_registry_user_idx ON public.sheet_registry (user_id);
CREATE INDEX sheet_registry_doc_idx  ON public.sheet_registry (user_id, document_id);

ALTER TABLE public.sheet_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY sr_owner_select ON public.sheet_registry
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY sr_service_all  ON public.sheet_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);
