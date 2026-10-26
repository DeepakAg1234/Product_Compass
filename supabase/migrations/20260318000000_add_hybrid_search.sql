-- Hybrid Search: Add full-text search alongside existing vector search
-- Uses generated tsvector column (auto-computed on INSERT/UPDATE, no changes to index-documents needed)

-- 1. Add generated tsvector column with weighted title (A) and chunk text (B)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'document_chunks' AND column_name = 'fts'
  ) THEN
    ALTER TABLE public.document_chunks
    ADD COLUMN fts tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(document_title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(chunk_text, '')), 'B')
    ) STORED;
  END IF;
END $$;

-- 2. GIN index for fast full-text lookups
CREATE INDEX IF NOT EXISTS idx_document_chunks_fts ON public.document_chunks USING gin (fts);

-- 3. keyword_search RPC (separate from match_documents so prepare-meeting is untouched)
CREATE OR REPLACE FUNCTION keyword_search(
  search_query text,
  match_count int default 10,
  user_uuid uuid default null
)
RETURNS TABLE (
  id uuid,
  document_id text,
  document_title text,
  document_type text,
  document_owner text,
  document_url text,
  chunk_text text,
  chunk_index int,
  rank real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id, dc.document_id, dc.document_title, dc.document_type,
    dc.document_owner, dc.document_url, dc.chunk_text, dc.chunk_index,
    ts_rank(dc.fts, websearch_to_tsquery('english', search_query))::real AS rank
  FROM document_chunks dc
  WHERE dc.user_id = user_uuid
    AND dc.fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;
