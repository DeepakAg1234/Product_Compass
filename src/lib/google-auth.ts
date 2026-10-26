import { supabase } from "@/integrations/supabase/client";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
].join(" ");

/**
 * Sign in with Google via Supabase Auth.
 * Requests Drive (read-only) scopes in a single consent screen.
 * The provider_token (Google access token) is preserved in the session.
 */
export async function signInWithGoogle(): Promise<{
  success: boolean;
  error?: Error;
}> {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: GOOGLE_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      return { success: false, error };
    }

    // The browser will redirect to Google — this line won't be reached
    return { success: true };
  } catch (err) {
    console.error("[google-auth] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
