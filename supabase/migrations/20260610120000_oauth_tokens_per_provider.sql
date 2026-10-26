-- Allow multiple OAuth providers per user. The table was UNIQUE(user_id), which
-- meant a user could only ever store ONE provider's token — connecting a second
-- provider (Linear) would overwrite the first (Google). Switch the uniqueness to
-- (user_id, provider) so Google and Linear tokens coexist.
--
-- Paired with: store-oauth-tokens + linear-oauth functions upsert on
-- (user_id, provider). Existing single Google row already satisfies the new key.
ALTER TABLE public.oauth_tokens DROP CONSTRAINT IF EXISTS oauth_tokens_user_id_key;
ALTER TABLE public.oauth_tokens
  ADD CONSTRAINT oauth_tokens_user_provider_key UNIQUE (user_id, provider);
