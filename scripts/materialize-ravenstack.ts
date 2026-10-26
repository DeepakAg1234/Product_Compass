// THROWAWAY Day 3 backfill — delete after Week 1.
// Loads the 5 RavenStack CSVs into sheets.* for one user and records them in
// sheet_registry. Run from repo root:
//
//   DATABASE_URL='postgresql://postgres.<ref>:<pwd>@<host>:5432/postgres' \
//   BACKFILL_EMAIL='you@example.com' \
//     deno run --allow-net --allow-read --allow-env scripts/materialize-ravenstack.ts
//
// Use the SESSION-mode connection string (port 5432) — DDL needs it, the 6543
// transaction pooler won't do CREATE TABLE reliably.
import { createPgClient } from "../supabase/functions/_shared/pg-client.ts";
import { materializeCsvAsTable } from "../supabase/functions/index-documents/materialize-sql.ts";

const url = Deno.env.get("DATABASE_URL") ?? Deno.env.get("SUPABASE_DB_URL");
if (!url) {
  console.error("Set DATABASE_URL (session-mode connection string).");
  Deno.exit(1);
}
const email = Deno.env.get("BACKFILL_EMAIL");
if (!email) {
  console.error("Set BACKFILL_EMAIL to the login email of the user to backfill.");
  Deno.exit(1);
}

const sql = createPgClient(url);

try {
  const users = await sql.unsafe(`SELECT id FROM auth.users WHERE email = $1 LIMIT 1`, [email]);
  if (users.length === 0) {
    console.error(`No auth.users row for ${email}. Set BACKFILL_EMAIL to your login email.`);
    Deno.exit(1);
  }
  const userId = users[0].id as string;
  console.log(`User: ${email} → ${userId}\n`);

  const dir = new URL("../evals/data/ravenstack/", import.meta.url);
  const files = [
    "ravenstack_accounts.csv",
    "ravenstack_churn_events.csv",
    "ravenstack_feature_usage.csv",
    "ravenstack_subscriptions.csv",
    "ravenstack_support_tickets.csv",
  ];

  for (const f of files) {
    const raw = await Deno.readTextFile(new URL(f, dir));
    const title = f.replace(/^ravenstack_/, "").replace(/\.csv$/, "");
    const res = await materializeCsvAsTable(sql, userId, { id: `ravenstack:${title}`, title }, raw);
    console.log(`✓ ${title.padEnd(16)} → sheets.${res.tableName}  (${res.rowCount} rows)`);
  }

  console.log("\nDone. Verify with the Day 3 DoD queries.");
} finally {
  await sql.end();
}
