import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PRODUCT_SCOPES = [
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
];

/**
 * Read the real remaining lifetime from Google. `exp` is absolute unix seconds;
 * `expires_in` is seconds from now. Scopes are whatever Google actually granted,
 * minus calendar (removed from this product).
 */
async function resolveGoogleToken(
  accessToken: string,
): Promise<{ expiresAt: string; scopes: string } | null> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) return null;

  const info = await res.json();
  const exp = Number(info.exp);
  const expiresIn = Number(info.expires_in);
  let expiresAt: string | null = null;
  if (Number.isFinite(exp) && exp > 0) {
    expiresAt = new Date(exp * 1000).toISOString();
  } else if (Number.isFinite(expiresIn) && expiresIn > 0) {
    expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  if (!expiresAt) return null;

  const granted = typeof info.scope === "string"
    ? info.scope.split(/\s+/).filter((scope: string) =>
      scope.length > 0 && !scope.includes("calendar")
    )
    : [];
  const scopes = granted.length > 0 ? granted.join(" ") : PRODUCT_SCOPES.join(" ");
  return { expiresAt, scopes };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { access_token, refresh_token } = await req.json();
    if (typeof access_token !== "string" || access_token.length === 0) {
      return new Response(JSON.stringify({ error: "Missing access_token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenInfo = await resolveGoogleToken(access_token);
    if (!tokenInfo) {
      return new Response(JSON.stringify({ error: "Could not read Google token expiry" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase.from("oauth_tokens").upsert(
      {
        user_id: user.id,
        provider: "google",
        access_token,
        refresh_token: typeof refresh_token === "string" ? refresh_token : null,
        expires_at: tokenInfo.expiresAt,
        scopes: tokenInfo.scopes,
      },
      { onConflict: "user_id,provider" }
    );

    if (error) {
      console.error("DB error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
