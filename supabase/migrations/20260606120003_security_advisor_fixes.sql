-- Resolve Supabase Security Advisor "RLS Disabled in Public" criticals.
--
-- prompt_templates: created by 20260330000000_prompt_registry.sql without RLS.
-- Only edge functions read it (service_role bypasses RLS), so enabling RLS
-- closes the anon-key exposure without a read policy. Add one only if the
-- frontend ever needs to read prompts directly.
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;

-- rs_accounts / rs_subscriptions / rs_churn_events: orphan tables loaded ad-hoc
-- during earlier RavenStack experimentation (not created by any migration, not
-- referenced by any code). The text-to-SQL pipeline re-materializes this data
-- properly into the sheets.* schema with per-user RLS, so these public copies
-- are redundant and publicly exposed. Drop them.
DROP TABLE IF EXISTS public.rs_accounts CASCADE;
DROP TABLE IF EXISTS public.rs_subscriptions CASCADE;
DROP TABLE IF EXISTS public.rs_churn_events CASCADE;
DROP TABLE IF EXISTS public.rs_feature_usage CASCADE;
DROP TABLE IF EXISTS public.rs_support_tickets CASCADE;
