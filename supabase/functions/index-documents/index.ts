import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPgClient, type PgClient } from "../_shared/pg-client.ts";
import { materializeCsvAsTable } from "./materialize-sql.ts";

// Day 5: when ON, tabular files are ALSO mirrored into the sheets schema as typed
// SQL tables (for the text-to-SQL path). Default OFF → existing vector indexing
// is completely unchanged. This is the kill switch for the whole feature.
const MATERIALIZE_SHEETS = Deno.env.get("MATERIALIZE_SHEETS") === "true";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 3; // lowered: finer chunking ~2x'd embeddings/batch, hitting the worker resource limit at 5
const MAX_CHUNKS_PER_DOC = 200; // bound per-doc embedding work so one huge doc can't exhaust the worker
const MAX_CONTENT_CHARS = 200_000; // truncate giant docs before chunking to bound worker memory
const CHUNK_SIZE = 800;   // same-corpus eval: 800/200 ≈ 1500/350 (tie within noise), slight edge on recall+judge. Sentence-aware splitting is the real win, not the size.
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 20;

const DRIVE_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
];

/** Detect if content is tabular (CSV-like) by checking if most lines have consistent comma counts */
function isTabularContent(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 3) return false;
  const commaCounts = lines.slice(0, 20).map((l) => (l.match(/,/g) || []).length);
  const firstCount = commaCounts[0];
  if (firstCount < 1) return false;
  const consistent = commaCounts.filter((c) => c === firstCount).length;
  return consistent / commaCounts.length >= 0.7;
}

interface ChunkResult {
  chunks: string[];
  content_type: "tabular" | "prose";
  // Day 11: per-chunk account_ids (tabular only), index-aligned with `chunks`,
  // so the hybrid path can join vector hits to SQL results. [] for prose.
  chunk_account_ids: string[][];
  // Per-chunk section heading (prose only), index-aligned with `chunks`. The
  // nearest preceding heading at the point the chunk was built; null if none.
  chunk_headings: (string | null)[];
}

function chunkText(text: string, title: string, chunkSize = CHUNK_SIZE, chunkOverlap = CHUNK_OVERLAP): ChunkResult {
  // Strip null bytes that cause PostgreSQL "unsupported Unicode escape sequence" errors
  const sanitized = text.replace(/\u0000/g, "");
  const prefix = `Document: ${title}\n\n`;

  if (isTabularContent(sanitized)) {
    return { ...chunkTabular(sanitized, prefix, chunkSize), content_type: "tabular", chunk_headings: [] };
  }

  const { chunks, headings } = chunkProse(sanitized, prefix, chunkSize, chunkOverlap);
  return { chunks, content_type: "prose", chunk_account_ids: [], chunk_headings: headings };
}

/** Find the index of an account-id-like column in a CSV header (or -1). */
function findAccountIdColumn(headerLine: string): number {
  const cols = headerLine.split(",").map((h) => h.trim().toLowerCase());
  return cols.findIndex((h) => h === "account_id" || h === "accountid" || h === "account id");
}

/**
 * Chunk tabular/CSV content — keeps the header row with every chunk, splits at
 * row boundaries, and records the distinct account_ids in each chunk (Day 11).
 * The id capture uses a naive comma split, fine because id values (e.g.
 * "A-2e4581") never contain commas.
 */
function chunkTabular(text: string, prefix: string, chunkSize: number): Omit<ChunkResult, "content_type" | "chunk_headings"> {
  const lines = text.split("\n");
  const headerLine = lines[0] || "";
  const dataLines = lines.slice(1);
  const idCol = findAccountIdColumn(headerLine);
  const chunks: string[] = [];
  const chunkAccountIds: string[][] = [];
  const chunkHeader = prefix + headerLine + "\n";
  let currentChunk = chunkHeader;
  let currentIds = new Set<string>();

  const flush = () => {
    chunks.push(currentChunk);
    chunkAccountIds.push([...currentIds]);
    currentChunk = chunkHeader;
    currentIds = new Set<string>();
  };

  for (const line of dataLines) {
    if (!line.trim()) continue;
    if (currentChunk.length + line.length + 1 > chunkSize && currentChunk !== chunkHeader) {
      flush();
    }
    currentChunk += line + "\n";
    if (idCol >= 0) {
      const v = line.split(",")[idCol]?.trim();
      if (v) currentIds.add(v);
    }
  }

  if (currentChunk !== chunkHeader) flush();

  if (chunks.length === 0) return { chunks: [prefix + "(empty document)"], chunk_account_ids: [[]] };
  return { chunks, chunk_account_ids: chunkAccountIds };
}

/** Split a paragraph into sentences (keeps terminal punctuation). */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Last-resort hard split for a single oversized sentence. */
function hardSplit(text: string, maxLen: number, overlap: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxLen, text.length);
    out.push(text.slice(start, end));
    if (end >= text.length) break;
    start += Math.max(1, maxLen - overlap);
  }
  return out;
}

/**
 * Best-effort heading detection for a single-line paragraph: markdown headings
 * (`# ...`), ALL-CAPS lines, or short Title-Case lines with no terminal
 * punctuation. Returns the heading text, or null if the paragraph isn't one.
 */
function detectHeading(para: string): string | null {
  const line = para.trim();
  if (!line || line.includes("\n")) return null;
  const md = line.match(/^#{1,6}\s+(.+)$/);
  if (md) return md[1].trim();
  if (line.length < 3 || line.length > 80 || /[.!?,;:]$/.test(line)) return null;
  if (line === line.toUpperCase() && /[A-Z]/.test(line)) return line; // ALL CAPS
  const words = line.split(/\s+/);
  if (words.length <= 10 && words.every((w) => /^[A-Z0-9("']/.test(w) || w.length <= 3)) return line; // Title Case
  return null;
}

/**
 * Chunk prose with a recursive, sentence-aware splitter. Splits into
 * paragraph → sentence → (rarely) char units, each within budget, then packs
 * units up to chunkSize with overlap — so the size cap actually holds and
 * chunks never cut mid-sentence. Tags each chunk with the nearest heading.
 */
function chunkProse(
  text: string,
  prefix: string,
  chunkSize: number,
  chunkOverlap: number,
): { chunks: string[]; headings: (string | null)[] } {
  const budget = Math.max(100, chunkSize);
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  // 1. Flatten to units no larger than budget, each tagged with its heading.
  const units: { text: string; heading: string | null }[] = [];
  let curHeading: string | null = null;
  for (const para of paragraphs) {
    const h = detectHeading(para);
    if (h) curHeading = h;
    const pieces = para.length <= budget
      ? [para]
      : splitSentences(para).flatMap((s) => (s.length <= budget ? [s] : hardSplit(s, budget, chunkOverlap)));
    for (const piece of pieces) units.push({ text: piece, heading: curHeading });
  }

  // 2. Greedily pack units into chunks, seeding overlap across boundaries.
  const chunks: string[] = [];
  const headings: (string | null)[] = [];
  let cur = "";
  let curH: string | null = null;
  for (const u of units) {
    if (cur && cur.length + u.text.length + 2 > budget) {
      chunks.push(prefix + cur);
      headings.push(curH);
      cur = chunkOverlap > 0 && cur.length > chunkOverlap ? cur.slice(-chunkOverlap) : "";
    }
    if (!cur) curH = u.heading;
    cur += (cur ? "\n\n" : "") + u.text;
  }
  if (cur.trim()) {
    chunks.push(prefix + cur);
    headings.push(curH);
  }

  if (chunks.length === 0) return { chunks: [prefix + "(empty document)"], headings: [null] };
  return { chunks, headings };
}

function getMimeExport(mimeType: string): { exportMime: string; method: "export" | "download" } {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return { exportMime: "text/plain", method: "export" };
    case "application/vnd.google-apps.spreadsheet":
      return { exportMime: "text/csv", method: "export" };
    case "application/vnd.google-apps.presentation":
      return { exportMime: "text/plain", method: "export" };
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/pdf":
    case "text/plain":
      return { exportMime: mimeType, method: "download" };
    default:
      return { exportMime: "text/plain", method: "export" };
  }
}

function getDocType(mimeType: string): string {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "doc";
    case "application/vnd.google-apps.spreadsheet":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "sheet";
    case "application/vnd.google-apps.presentation":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "slide";
    case "application/pdf": return "pdf";
    case "text/plain": return "doc";
    default: return "unknown";
  }
}

function getDocUrl(fileId: string, mimeType: string): string {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return `https://docs.google.com/document/d/${fileId}`;
    case "application/vnd.google-apps.spreadsheet":
      return `https://docs.google.com/spreadsheets/d/${fileId}`;
    case "application/vnd.google-apps.presentation":
      return `https://docs.google.com/presentation/d/${fileId}`;
    default:
      return `https://drive.google.com/file/d/${fileId}`;
  }
}

const OFFICE_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function sanitizeBinaryText(buffer: ArrayBuffer): string | null {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  // Strip null bytes and control characters, keeping newlines (\n), carriage returns (\r), and tabs (\t)
  const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  // If almost no readable text survived, the file is likely all binary
  if (cleaned.trim().length < 50) return null;
  return cleaned;
}

async function fetchFileContent(fileId: string, mimeType: string, accessToken: string): Promise<string | null> {
  try {
    const { exportMime, method } = getMimeExport(mimeType);

    let url: string;
    if (method === "export") {
      url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
    } else {
      url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      console.error(`Failed to fetch file ${fileId}: ${res.status}`);
      return null;
    }

    // Office binary files: decode from arrayBuffer and sanitize
    if (OFFICE_MIME_TYPES.has(mimeType)) {
      const buffer = await res.arrayBuffer();
      return sanitizeBinaryText(buffer);
    }

    if (mimeType === "application/pdf") {
      const buffer = await res.arrayBuffer();
      return sanitizeBinaryText(buffer);
    }

    return await res.text();
  } catch (err) {
    console.error(`Error fetching file ${fileId}:`, err);
    return null;
  }
}

async function generateEmbeddings(texts: string[], apiKey: string): Promise<(number[] | null)[]> {
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: "text-embedding-3-small",
      }),
    });

    if (!res.ok) {
      console.error(`OpenAI embeddings error: ${res.status}`);
      return texts.map(() => null);
    }

    const data = await res.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return texts.map(() => null);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Day 5: lazy Postgres client for sheet materialization. Created on first
  // tabular file only (so non-tabular batches pay nothing); closed in finally
  // so the connection is always released, on success or error.
  let pg: PgClient | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User-scoped client for reading oauth_tokens (respects RLS)
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

    // Service role client for DB writes (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse request body
    let offset = 0;
    let chunkSize = CHUNK_SIZE;
    let chunkOverlap = CHUNK_OVERLAP;
    try {
      const body = await req.json();
      offset = body.offset || 0;
      if (body.chunk_size && Number.isFinite(body.chunk_size) && body.chunk_size > 0) {
        chunkSize = body.chunk_size;
      }
      if (body.chunk_overlap && Number.isFinite(body.chunk_overlap) && body.chunk_overlap >= 0) {
        chunkOverlap = body.chunk_overlap;
      }
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Get Google access token (with refresh logic)
    const { data: tokenData, error: tokenError } = await supabase
      .from("oauth_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("provider", "google")
      .single();

    if (tokenError || !tokenData) {
      return new Response(JSON.stringify({ error: "Google token not found. Please re-authenticate." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let googleToken = tokenData.access_token;

    // Check if token is expired (or expires within 60s)
    const isExpired = tokenData.expires_at &&
      new Date(tokenData.expires_at).getTime() < Date.now() + 60_000;

    console.log("Token expires_at:", tokenData.expires_at, "isExpired:", isExpired);

    if (isExpired && tokenData.refresh_token) {
      console.log("Refreshing token...");
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
          client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
          refresh_token: tokenData.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!refreshRes.ok) {
        console.error("Token refresh failed:", await refreshRes.text());
        return new Response(JSON.stringify({ error: "Google token expired and refresh failed. Please re-authenticate." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const refreshData = await refreshRes.json();
      googleToken = refreshData.access_token;

      const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
      await serviceClient
        .from("oauth_tokens")
        .update({ access_token: googleToken, expires_at: newExpiresAt })
        .eq("user_id", user.id)
        .eq("provider", "google");
    }

    // Clean slate: delete all existing chunks only on first batch
    if (offset === 0) {
      await serviceClient
        .from("document_chunks")
        .delete()
        .eq("user_id", user.id);
    }

    // List files from Google Drive
    const mimeQuery = DRIVE_MIME_TYPES.map((m) => `mimeType='${m}'`).join(" or ");
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=(${encodeURIComponent(mimeQuery)}) and trashed=false&orderBy=modifiedTime desc&pageSize=200&fields=files(id,name,mimeType,owners)`;

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${googleToken}` },
    });

    if (listRes.status === 401) {
      return new Response(JSON.stringify({ error: "Google token expired. Please re-authenticate." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!listRes.ok) {
      const errText = await listRes.text();
      console.error("Drive API error:", errText);
      return new Response(JSON.stringify({ error: "Failed to list Google Drive files" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listData = await listRes.json();
    const allFiles = listData.files || [];
    console.log("Drive API status:", listRes.status, "Files found:", allFiles.length);
    const total = allFiles.length;
    const filesToProcess = allFiles.slice(offset, offset + BATCH_SIZE);
    const processed = filesToProcess.length;
    const remaining = Math.max(0, total - offset - processed);

    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    // Process each file in this batch
    for (const file of filesToProcess) {
      try {
        let content = await fetchFileContent(file.id, file.mimeType, googleToken);
        if (!content) continue;
        if (content.length > MAX_CONTENT_CHARS) {
          console.warn(`Truncating ${file.name}: ${content.length} → ${MAX_CONTENT_CHARS} chars`);
          content = content.slice(0, MAX_CONTENT_CHARS);
        }

        const parsed = chunkText(content, file.name, chunkSize, chunkOverlap);
        const content_type = parsed.content_type;
        if (parsed.chunks.length > MAX_CHUNKS_PER_DOC) {
          console.warn(`Capping ${file.name}: ${parsed.chunks.length} chunks → ${MAX_CHUNKS_PER_DOC}`);
        }
        const chunks = parsed.chunks.slice(0, MAX_CHUNKS_PER_DOC);
        const chunk_account_ids = parsed.chunk_account_ids.slice(0, MAX_CHUNKS_PER_DOC);
        const chunk_headings = parsed.chunk_headings.slice(0, MAX_CHUNKS_PER_DOC);
        const docType = getDocType(file.mimeType);
        const docUrl = getDocUrl(file.id, file.mimeType);
        const ownerEmail = file.owners?.[0]?.emailAddress || null;

        // Generate embeddings in batches
        const allEmbeddings: (number[] | null)[] = [];
        for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
          const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
          const embeddings = await generateEmbeddings(batch, openaiKey);
          allEmbeddings.push(...embeddings);
        }

        // If all embeddings failed, skip this document
        if (allEmbeddings.every((e) => e === null)) {
          console.error(`All embeddings failed for ${file.name}, skipping`);
          continue;
        }

        // Delete existing chunks for this document
        await serviceClient
          .from("document_chunks")
          .delete()
          .eq("user_id", user.id)
          .eq("document_id", file.id);

        // Insert new chunks
        const rows = chunks.map((chunkText, idx) => ({
          user_id: user.id,
          document_id: file.id,
          document_title: file.name,
          document_type: docType,
          document_owner: ownerEmail,
          document_url: docUrl,
          chunk_index: idx,
          chunk_text: chunkText,
          embedding: allEmbeddings[idx] ? JSON.stringify(allEmbeddings[idx]) : null,
          metadata: {
            source: "google_drive",
            content_type,
            // Day 11: account_ids present in this chunk (tabular only) — the
            // join key for hybrid reconciliation. Omitted when none.
            ...(chunk_account_ids[idx]?.length ? { account_ids: chunk_account_ids[idx] } : {}),
            // Section heading this chunk falls under (prose only). Omitted when none.
            ...(chunk_headings[idx] ? { heading: chunk_headings[idx] } : {}),
          },
        }));

        const { error: insertError } = await serviceClient
          .from("document_chunks")
          .insert(rows);

        if (insertError) {
          console.error(`Insert error for ${file.name}:`, insertError);
        }

        // Day 5: ALSO mirror tabular files into a typed SQL table. Isolated in
        // its own try/catch — a materialization failure must never break the
        // (working) vector path above, which already committed its chunks.
        if (MATERIALIZE_SHEETS && content_type === "tabular") {
          try {
            pg = pg ?? createPgClient();
            // Strip null bytes (Postgres rejects them) — same guard as chunkText.
            const cleanCsv = content.replace(/\0/g, "");
            const res = await materializeCsvAsTable(
              pg,
              user.id,
              { id: file.id, title: file.name },
              cleanCsv,
            );
            console.log(`Materialized ${file.name} → sheets.${res.tableName} (${res.rowCount} rows)`);
          } catch (matErr) {
            console.error(`Materialization failed for ${file.name} (vector chunks unaffected):`, matErr);
          }
        }
      } catch (err) {
        console.error(`Error processing file ${file.name}:`, err);
        continue;
      }
    }

    const status = remaining > 0 ? "in_progress" : "complete";

    return new Response(
      JSON.stringify({ processed, remaining, total, status }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (pg) await pg.end();
  }
});
