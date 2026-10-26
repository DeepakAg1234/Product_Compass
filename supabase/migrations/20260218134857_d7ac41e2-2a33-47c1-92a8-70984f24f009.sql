create or replace function match_documents(
  query_embedding vector(1536),
  match_count int default 5,
  match_threshold float default 0.3,
  user_uuid uuid default null
)
returns table (
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
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  return query
  select
    dc.id,
    dc.document_id,
    dc.document_title,
    dc.document_type,
    dc.document_owner,
    dc.document_url,
    dc.chunk_text,
    dc.chunk_index,
    (1 - (dc.embedding <=> query_embedding))::float as similarity
  from document_chunks dc
  where dc.user_id = user_uuid
    and 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
end;
$$;