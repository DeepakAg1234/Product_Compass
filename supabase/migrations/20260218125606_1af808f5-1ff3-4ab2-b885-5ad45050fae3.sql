
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Table 1: document_chunks
CREATE TABLE public.document_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  document_title TEXT NOT NULL,
  document_type TEXT,
  document_owner TEXT,
  document_url TEXT,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composite index for fast lookups
CREATE INDEX idx_document_chunks_user_doc ON public.document_chunks (user_id, document_id);

-- HNSW index for fast similarity search on embeddings
CREATE INDEX idx_document_chunks_embedding ON public.document_chunks USING hnsw (embedding vector_cosine_ops);

-- Enable RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own document_chunks" ON public.document_chunks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own document_chunks" ON public.document_chunks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own document_chunks" ON public.document_chunks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own document_chunks" ON public.document_chunks FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_document_chunks_updated_at
  BEFORE UPDATE ON public.document_chunks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table 2: meetings
CREATE TABLE public.meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  attendees JSONB,
  meeting_url TEXT,
  brief TEXT,
  brief_generated_at TIMESTAMPTZ,
  relevant_document_ids TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_calendar_event UNIQUE (user_id, calendar_event_id)
);

-- Index for querying upcoming meetings
CREATE INDEX idx_meetings_user_start ON public.meetings (user_id, start_time);

-- Enable RLS
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own meetings" ON public.meetings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own meetings" ON public.meetings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own meetings" ON public.meetings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own meetings" ON public.meetings FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
