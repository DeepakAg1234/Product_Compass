-- Text-to-SQL: per-query observability. One row per /search request once the
-- router is wired in. Captures the full decision trail: route chosen, raw vs.
-- executed SQL, timings, and any error/rejection reason. Powers the AnswerTrace
-- UI and the eval audit (e.g. "zero permission denied in search_trace").

CREATE TABLE IF NOT EXISTS public.search_trace (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  query           text NOT NULL,
  mode            text NOT NULL,                  -- sql|vector|hybrid
  router_reason   text,
  router_confidence numeric(3,2),
  router_ms       int4,
  sql_raw         text,                           -- LLM output, pre-allowlist
  sql_executed    text,                           -- post-AST-rewrite
  sql_tables      text[],
  sql_rejected_reason text,
  exec_ms         int4,
  row_count       int4,
  truncated       bool,
  vector_chunks   int4,
  synth_input_chars int4,
  synth_output_chars int4,
  synth_ms        int4,
  total_ms        int4,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Named so IF NOT EXISTS is meaningful (anonymous indexes can't be guarded).
CREATE INDEX IF NOT EXISTS search_trace_user_idx  ON public.search_trace (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS search_trace_mode_idx  ON public.search_trace (mode, created_at DESC);
CREATE INDEX IF NOT EXISTS search_trace_error_idx ON public.search_trace (created_at DESC) WHERE error IS NOT NULL;

ALTER TABLE public.search_trace ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS st_owner ON public.search_trace;
CREATE POLICY st_owner ON public.search_trace USING (auth.uid() = user_id);
