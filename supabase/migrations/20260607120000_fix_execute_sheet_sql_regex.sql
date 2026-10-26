-- Fix execute_sheet_sql's belt-and-suspenders SELECT check.
--
-- The original guard used `p_sql !~* '^\s*select\b'`. PostgreSQL's regex engine
-- treats `\b` as a literal BACKSPACE character (not a word boundary, which is
-- `\y`), so the pattern never matched real SQL and the function rejected EVERY
-- query with "only SELECT permitted". The AST allowlist + sheets_reader role are
-- the real enforcers; this guard just needs to be correct, not the only line of
-- defense. Also accept WITH … SELECT (read-only CTEs), which the TS executor
-- already permits.
CREATE OR REPLACE FUNCTION public.execute_sheet_sql(
  p_user_id uuid,
  p_sql     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sheets, pg_temp
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF p_sql !~* '^\s*(select|with)\y' THEN
    RAISE EXCEPTION 'only SELECT permitted';
  END IF;

  PERFORM set_config('request.user_id', p_user_id::text, true);
  SET LOCAL ROLE sheets_reader;
  SET LOCAL statement_timeout = '5s';
  SET LOCAL idle_in_transaction_session_timeout = '5s';
  SET LOCAL lock_timeout = '1s';

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', p_sql)
    INTO v_rows;

  RESET ROLE;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.execute_sheet_sql(uuid, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.execute_sheet_sql(uuid, text) TO service_role;
