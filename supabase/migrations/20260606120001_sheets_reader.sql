-- Text-to-SQL: read-only Postgres role + SECURITY DEFINER execution wrapper.
-- The SQL executor swaps into `sheets_reader` so the database itself (not regex)
-- enforces SELECT-only. The role can read sheets.* and nothing else.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sheets_reader') THEN
    CREATE ROLE sheets_reader NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA sheets TO sheets_reader;
REVOKE CREATE ON SCHEMA sheets FROM sheets_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA sheets
  GRANT SELECT ON TABLES TO sheets_reader;

-- Defense in depth: deny schema access elsewhere.
-- NOTE: the original plan also did `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA
-- pg_catalog` here. Removed: pg_catalog functions are granted to PUBLIC (not to
-- this role), so the revoke is a no-op that emits ~1000 warnings and was
-- stalling `supabase db push`. The real guards against pg_read_file()-style
-- calls are search_path=sheets pinning + the AST function-name blocklist.
REVOKE ALL ON SCHEMA public  FROM sheets_reader;
REVOKE ALL ON SCHEMA auth    FROM sheets_reader;
REVOKE ALL ON SCHEMA storage FROM sheets_reader;

GRANT sheets_reader TO service_role;  -- so SET ROLE works

-- SECURITY DEFINER wrapper: sets role + per-user GUC + timeouts, then runs the
-- generated SELECT wrapped in jsonb_agg. Regex guard is belt-and-suspenders;
-- the role is the real enforcer.
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
  IF p_sql !~* '^\s*select\b' THEN
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
