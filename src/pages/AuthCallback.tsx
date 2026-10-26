import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error || !session) {
          console.error("Auth callback error:", error);
          navigate("/", { replace: true });
          return;
        }

        // Store the Google provider token if available
        // This is only available immediately after OAuth sign-in
        if (session.provider_token) {
          console.log("[AuthCallback] Storing Google provider token");
          const { error: storeError } = await supabase.functions.invoke("store-oauth-tokens", {
            body: {
              access_token: session.provider_token,
              refresh_token: session.provider_refresh_token || null,
            },
          });
          if (storeError) {
            console.error("[AuthCallback] Failed to store Google token:", storeError);
          }
        }

        navigate("/dashboard", { replace: true });
      } catch (err) {
        console.error("Auth callback unexpected error:", err);
        navigate("/", { replace: true });
      }
    };

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" && session) {
          handleCallback();
        }
      }
    );

    // Also try immediately in case the session is already set
    handleCallback();

    const timeout = setTimeout(() => navigate("/", { replace: true }), 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-secondary-bg flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Completing sign-in...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
