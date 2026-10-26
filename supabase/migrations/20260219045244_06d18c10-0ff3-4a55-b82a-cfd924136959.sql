CREATE POLICY "Users can delete their own tokens"
  ON public.oauth_tokens
  FOR DELETE
  USING (auth.uid() = user_id);