import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPgClient } from "../_shared/pg-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Mirror of materialize-sql nameTable: `u_<32 hex>_<slug>`. */
function isOwnedSheetTable(userId: string, tableName: string): boolean {
  const uid = userId.replace(/-/g, "").toLowerCase();
  return (
    tableName.length <= 63 &&
    tableName.startsWith(`u_${uid}_`) &&
    /^u_[0-9a-f]{32}_[a-z0-9_]+$/.test(tableName)
  );
}

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
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: registry, error: registryError } = await serviceClient
      .from("sheet_registry")
      .select("table_name")
      .eq("user_id", user.id);

    if (registryError) {
      console.error("sheet_registry read failed:", registryError);
      return new Response(JSON.stringify({ error: "Could not list sheet tables" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tableNames = (registry ?? []).map((row) => row.table_name as string);
    const unexpected = tableNames.filter((name) => !isOwnedSheetTable(user.id, name));
    if (unexpected.length > 0) {
      console.error("Refusing to drop unexpected tables:", unexpected);
      return new Response(JSON.stringify({ error: "Unexpected sheet table name" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tableNames.length > 0) {
      const sql = createPgClient();
      try {
        for (const tableName of tableNames) {
          await sql.unsafe(`DROP TABLE IF EXISTS sheets.${quoteIdent(tableName)} CASCADE`);
        }
      } finally {
        await sql.end();
      }
    }

    const { error: traceError } = await serviceClient
      .from("search_trace")
      .delete()
      .eq("user_id", user.id);
    if (traceError) {
      console.error("search_trace delete failed:", traceError);
      return new Response(JSON.stringify({ error: "Could not delete search history" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error("auth delete failed:", deleteError);
      return new Response(JSON.stringify({ error: "Could not delete auth user" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-account error:", err);
    const message = err instanceof Error && err.message.includes("DATABASE_URL")
      ? "DATABASE_URL is required to drop sheet tables"
      : "Internal error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
