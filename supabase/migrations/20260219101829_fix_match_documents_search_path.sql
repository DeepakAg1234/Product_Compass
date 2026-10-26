-- Set search_path so the vector type and <=> operator are visible during creation
SET search_path = 'public', 'extensions';

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_count int default 5,
  match_threshold float default 0.3,
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
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.document_title,
    dc.document_type,
    dc.document_owner,
    dc.document_url,
    dc.chunk_text,
    dc.chunk_index,
    (1 - (dc.embedding <=> query_embedding))::float AS similarity
  FROM document_chunks dc
  WHERE dc.user_id = user_uuid
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
