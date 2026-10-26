/**
 * Re-index all documents via the index-documents edge function.
 * Uses the same auth approach as run-evals.ts (service role impersonation).
 *
 * Usage:
 *   deno run --allow-net --allow-env evals/reindex.ts
 *
 * Env vars (same as run-evals.ts):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, EVAL_USER_EMAIL
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVAL_USER_EMAIL = Deno.env.get("EVAL_USER_EMAIL")!;

async function getAccessToken(): Promise<string> {
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: EVAL_USER_EMAIL,
  });
  if (linkError || !linkData) throw new Error(`Failed to generate link: ${linkError?.message}`);

  const { data: verifyData, error: verifyError } = await adminClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !verifyData.session) throw new Error(`Failed to verify OTP: ${verifyError?.message}`);

  return verifyData.session.access_token;
}

async function reindex(accessToken: string): Promise<void> {
  const functionUrl = `${SUPABASE_URL}/functions/v1/index-documents`;
  const startOffset = parseInt(Deno.env.get("REINDEX_OFFSET") || "0", 10);
  const chunkSize = Deno.env.get("REINDEX_CHUNK_SIZE");
  const chunkOverlap = Deno.env.get("REINDEX_CHUNK_OVERLAP");
  if (chunkSize) console.log(`chunk_size=${chunkSize}, chunk_overlap=${chunkOverlap ?? "default"}`);
  let offset = startOffset;
  let remaining = 1; // start loop

  console.log("Starting re-index...\n");

  while (remaining > 0) {
    const res = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        offset,
        ...(chunkSize ? { chunk_size: Number(chunkSize) } : {}),
        ...(chunkOverlap ? { chunk_overlap: Number(chunkOverlap) } : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`index-documents failed (status ${res.status}): ${errText}`);
    }

    const data = await res.json();
    const processed = data.processed || 0;
    remaining = data.remaining || 0;
    const total = data.total || 0;

    console.log(`  Batch offset=${offset}: processed ${processed}, remaining ${remaining}, total ${total}`);

    offset += processed;

    if (processed === 0) break; // safety: no progress
  }

  console.log("\nRe-index complete!");
}

// Main
const accessToken = await getAccessToken();
console.log(`Authenticated as ${EVAL_USER_EMAIL}`);
await reindex(accessToken);
