/**
 * PM Compass RAG Pipeline Evaluation Harness
 *
 * Runs golden dataset queries against the search-documents edge function
 * and computes retrieval + answer quality metrics.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
 *
 * Required env vars:
 *   SUPABASE_URL           - Your Supabase project URL
 *   SUPABASE_ANON_KEY      - Supabase anon/public key
 *   EVAL_USER_EMAIL        - Email of the test user account
 *   EVAL_USER_PASSWORD     - Password (or omit + set SUPABASE_SERVICE_ROLE_KEY for OAuth users)
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (alternative to password for OAuth-only users)
 *   ANTHROPIC_API_KEY      - For LLM-as-judge scoring
 *
 * Optional env vars:
 *   EVAL_DATASET_PATH      - Path to golden dataset (default: evals/golden-dataset.json)
 *   EVAL_RESULTS_DIR       - Output directory (default: evals/results)
 *   EVAL_RUN_NAME          - Name prefix for this run (default: "baseline")
 *   EVAL_K                 - K value for Recall@K and Precision@K (default: 5)
 *   EVAL_SKIP_LLM_JUDGE    - Set to "true" to skip LLM-as-judge (saves API cost)
 *   EVAL_LLM_JUDGE_MODEL   - Model for LLM-as-judge (default: claude-haiku-4-5-20251001)
 *   EVAL_SKIP_FAITHFULNESS  - Set to "true" to skip faithfulness scoring (saves API cost)
 *   EVAL_FAITHFULNESS_MODEL - Model for faithfulness judge (default: claude-haiku-4-5-20251001)
 *   EVAL_MATCH_THRESHOLD   - Cosine similarity threshold (default: 0.5)
 *   EVAL_CONCURRENCY       - Max concurrent queries (default: 3)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GoldenQuery {
  id: string;
  query: string;
  category: string;
  difficulty: string;
  expected_doc_ids: string[];
  expected_answer_contains: string[];
  notes: string;
}

interface GoldenDataset {
  version: string;
  created_at: string;
  description: string;
  queries: GoldenQuery[];
}

interface SearchSource {
  document_id: string;
  document_title: string;
  document_type: string;
  document_url: string;
  document_owner: string;
  similarity: number;
  chunk_text: string;
}

interface SearchResponse {
  answer: string;
  sources: SearchSource[];
  query: string;
  error?: string;
}

interface QueryResult {
  query_id: string;
  query: string;
  category: string;
  difficulty: string;
  // Raw response
  answer: string;
  sources: SearchSource[];
  latency_ms: number;
  // Retrieval metrics
  expected_doc_ids: string[];
  retrieved_doc_ids: string[];
  recall_at_k: number;
  precision_at_k: number;
  reciprocal_rank: number;
  // Answer quality metrics
  factual_containment: number;
  expected_phrases_found: string[];
  expected_phrases_missing: string[];
  citation_accuracy: number;
  // LLM-as-judge (optional)
  llm_judge_score: number | null;
  llm_judge_explanation: string | null;
  // Faithfulness (optional)
  faithfulness_score: number | null;
  faithfulness_explanation: string | null;
  faithfulness_claims: { claim: string; verdict: string; evidence: string }[] | null;
}

interface EvalResults {
  run_id: string;
  timestamp: string;
  config: {
    embedding_model: string;
    synthesis_model: string;
    chunk_size: number;
    match_threshold: number;
    match_count: number;
    max_tokens: number;
    k: number;
    prompt_version: number | string;
    qe_version: number | string;
  };
  aggregate: {
    total_queries: number;
    recall_at_k: number;
    precision_at_k: number;
    mrr: number;
    factual_containment: number;
    citation_accuracy: number;
    llm_judge_avg: number | null;
    faithfulness_avg: number | null;
    avg_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
    max_latency_ms: number;
    by_category: Record<string, CategoryMetrics>;
    by_difficulty: Record<string, CategoryMetrics>;
  };
  per_query: QueryResult[];
}

interface CategoryMetrics {
  count: number;
  recall_at_k: number;
  precision_at_k: number;
  mrr: number;
  factual_containment: number;
  citation_accuracy: number;
  llm_judge_avg: number | null;
  faithfulness_avg: number | null;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EVAL_USER_EMAIL = Deno.env.get("EVAL_USER_EMAIL");
const EVAL_USER_PASSWORD = Deno.env.get("EVAL_USER_PASSWORD");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const MATCH_THRESHOLD = parseFloat(Deno.env.get("EVAL_MATCH_THRESHOLD") || "0.5");
const DATASET_PATH = Deno.env.get("EVAL_DATASET_PATH") || "evals/golden-dataset.json";
const RESULTS_DIR = Deno.env.get("EVAL_RESULTS_DIR") || "evals/results";
const RUN_NAME = Deno.env.get("EVAL_RUN_NAME") || `threshold-${MATCH_THRESHOLD}`;
const K = parseInt(Deno.env.get("EVAL_K") || "5", 10);
const SKIP_LLM_JUDGE = Deno.env.get("EVAL_SKIP_LLM_JUDGE") === "true";
const LLM_JUDGE_MODEL = Deno.env.get("EVAL_LLM_JUDGE_MODEL") || "claude-haiku-4-5-20251001";
const SKIP_FAITHFULNESS = Deno.env.get("EVAL_SKIP_FAITHFULNESS") === "true";
const FAITHFULNESS_MODEL = Deno.env.get("EVAL_FAITHFULNESS_MODEL") || "claude-haiku-4-5-20251001";
const CONCURRENCY = parseInt(Deno.env.get("EVAL_CONCURRENCY") || "3", 10);

// Prompt experiment versions (optional — omit to use active/default prompts)
const PROMPT_VERSION = Deno.env.get("EVAL_PROMPT_VERSION")
  ? parseInt(Deno.env.get("EVAL_PROMPT_VERSION")!, 10)
  : undefined;
const QE_VERSION = Deno.env.get("EVAL_QE_VERSION")
  ? parseInt(Deno.env.get("EVAL_QE_VERSION")!, 10)
  : undefined;

// Current pipeline config (for recording in results)
const PIPELINE_CONFIG = {
  embedding_model: "text-embedding-3-small",
  synthesis_model: "claude-haiku-4-5-20251001",
  chunk_size: 800,
  match_threshold: MATCH_THRESHOLD,
  match_count: 10,
  max_tokens: 500,
  k: K,
  prompt_version: PROMPT_VERSION ?? "active",
  qe_version: QE_VERSION ?? "active",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[eval] ${msg}`);
}

function logError(msg: string) {
  console.error(`[eval:error] ${msg}`);
}

/** Run promises with limited concurrency */
async function pooled<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// ─── Metric Computation ──────────────────────────────────────────────────────

function computeRecallAtK(expectedDocIds: string[], retrievedDocIds: string[], k: number): number {
  if (expectedDocIds.length === 0) return 1.0; // Negative queries: if we expect nothing and get nothing/anything, recall is 1
  const topK = retrievedDocIds.slice(0, k);
  const found = expectedDocIds.filter((id) => topK.includes(id));
  return found.length / expectedDocIds.length;
}

function computePrecisionAtK(expectedDocIds: string[], retrievedDocIds: string[], k: number): number {
  if (expectedDocIds.length === 0) {
    // For negative queries: precision is 1 if no results, 0 otherwise
    return retrievedDocIds.length === 0 ? 1.0 : 0.0;
  }
  const topK = retrievedDocIds.slice(0, k);
  const found = expectedDocIds.filter((id) => topK.includes(id));
  return topK.length > 0 ? found.length / topK.length : 0.0;
}

function computeReciprocalRank(expectedDocIds: string[], retrievedDocIds: string[]): number {
  if (expectedDocIds.length === 0) {
    // For negative queries: RR is 1 if no results returned (correct behavior)
    return retrievedDocIds.length === 0 ? 1.0 : 0.0;
  }
  for (let i = 0; i < retrievedDocIds.length; i++) {
    if (expectedDocIds.includes(retrievedDocIds[i])) {
      return 1.0 / (i + 1);
    }
  }
  return 0.0;
}

function computeFactualContainment(
  expectedPhrases: string[],
  answer: string,
): { score: number; found: string[]; missing: string[] } {
  if (expectedPhrases.length === 0) return { score: 1.0, found: [], missing: [] };
  const lowerAnswer = answer.toLowerCase();
  const found: string[] = [];
  const missing: string[] = [];
  for (const phrase of expectedPhrases) {
    if (lowerAnswer.includes(phrase.toLowerCase())) {
      found.push(phrase);
    } else {
      missing.push(phrase);
    }
  }
  return { score: found.length / expectedPhrases.length, found, missing };
}

function computeCitationAccuracy(
  expectedDocIds: string[],
  sources: SearchSource[],
): number {
  if (expectedDocIds.length === 0) {
    return sources.length === 0 ? 1.0 : 0.0;
  }
  const citedDocIds = sources.map((s) => s.document_id);
  const correctCitations = expectedDocIds.filter((id) => citedDocIds.includes(id));
  return correctCitations.length / expectedDocIds.length;
}

// ─── LLM-as-Judge ────────────────────────────────────────────────────────────

async function llmJudge(
  query: string,
  expectedPhrases: string[],
  actualAnswer: string,
): Promise<{ score: number; explanation: string }> {
  if (!ANTHROPIC_API_KEY) {
    return { score: -1, explanation: "ANTHROPIC_API_KEY not set" };
  }

  const prompt = `You are evaluating a RAG (Retrieval-Augmented Generation) system's answer quality.

Rate the following answer on a scale of 1-5:
1 = Completely wrong, irrelevant, or hallucinated
2 = Partially relevant but missing key facts or contains errors
3 = Adequate — addresses the query but lacks detail or precision
4 = Good — accurate and relevant with minor gaps
5 = Excellent — comprehensive, accurate, well-cited

Query: "${query}"
Expected key facts: [${expectedPhrases.join(", ")}]
Actual answer: "${actualAnswer}"

Respond with ONLY a JSON object (no markdown, no code fences):
{"score": <1-5>, "explanation": "<one sentence>"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_JUDGE_MODEL,
        max_tokens: 150,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      logError(`LLM judge API error: ${res.status} ${errText}`);
      return { score: -1, explanation: `API error: ${res.status}` };
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || "";
    const text = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(text);
    return {
      score: Math.max(1, Math.min(5, parsed.score)),
      explanation: parsed.explanation || "",
    };
  } catch (err) {
    logError(`LLM judge failed: ${err}`);
    return { score: -1, explanation: `Parse/network error: ${err}` };
  }
}

// ─── Faithfulness ────────────────────────────────────────────────────────────

async function faithfulnessJudge(
  query: string,
  answer: string,
  chunks: string[],
): Promise<{ score: number; explanation: string; claims: { claim: string; verdict: string; evidence: string }[] }> {
  if (!ANTHROPIC_API_KEY) {
    return { score: -1, explanation: "ANTHROPIC_API_KEY not set", claims: [] };
  }

  if (!answer || answer.includes("couldn't find")) {
    // "No results" answers are trivially faithful
    return { score: 5, explanation: "No-result answer — nothing to hallucinate", claims: [] };
  }

  const chunksText = chunks.map((c, i) => `[Chunk ${i + 1}]\n${c}`).join("\n\n");

  const prompt = `You are a rigorous evaluator checking whether a RAG system's answer is faithful to its source documents.

Your task: go through the answer claim by claim and check if each factual claim (numbers, dates, quotes, statistics, names, percentages) can be found in the source chunks.

Step-by-step process:
1. List the key factual claims in the answer
2. For each claim, state whether it is SUPPORTED (found verbatim or clearly stated in a chunk), UNSUPPORTED (not in any chunk), or PARTIAL (related info exists but specific detail is added)
3. Give a final score

Scoring:
1 = Mostly hallucinated — majority of claims not in chunks
2 = Significant fabrication — some claims supported, but key facts invented
3 = Partially faithful — main points grounded, but includes unsupported details or numbers
4 = Mostly faithful — nearly all claims in chunks, only minor embellishments
5 = Fully faithful — every claim traceable to chunks

Query: "${query}"

Source chunks:
${chunksText}

Answer to evaluate:
"${answer}"

Respond with ONLY a JSON object (no markdown, no code fences):
{"claims": [{"claim": "<factual claim>", "verdict": "SUPPORTED|UNSUPPORTED|PARTIAL", "evidence": "<which chunk or why not found>"}], "score": <1-5>, "explanation": "<summary judgement>"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FAITHFULNESS_MODEL,
        max_tokens: 2000,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      logError(`Faithfulness judge API error: ${res.status} ${errText}`);
      return { score: -1, explanation: `API error: ${res.status}`, claims: [] };
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || "";
    const text = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(text);
    return {
      score: Math.max(1, Math.min(5, parsed.score)),
      explanation: parsed.explanation || "",
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
    };
  } catch (err) {
    logError(`Faithfulness judge failed: ${err}`);
    return { score: -1, explanation: `Parse/network error: ${err}`, claims: [] };
  }
}

// ─── Aggregate Metrics ───────────────────────────────────────────────────────

function aggregateResults(results: QueryResult[]): EvalResults["aggregate"] {
  const total = results.length;
  if (total === 0) {
    return {
      total_queries: 0,
      recall_at_k: 0,
      precision_at_k: 0,
      mrr: 0,
      factual_containment: 0,
      citation_accuracy: 0,
      llm_judge_avg: null,
      faithfulness_avg: null,
      avg_latency_ms: 0,
      by_category: {},
      by_difficulty: {},
    };
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  // Nearest-rank percentile (p in [0,1]).
  const pct = (arr: number[], p: number) => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  };

  const llmScores = results
    .map((r) => r.llm_judge_score)
    .filter((s): s is number => s !== null && s > 0);

  const faithScores = results
    .map((r) => r.faithfulness_score)
    .filter((s): s is number => s !== null && s > 0);

  // Group by category and difficulty
  const byCategory: Record<string, QueryResult[]> = {};
  const byDifficulty: Record<string, QueryResult[]> = {};
  for (const r of results) {
    (byCategory[r.category] ??= []).push(r);
    (byDifficulty[r.difficulty] ??= []).push(r);
  }

  function computeGroupMetrics(group: QueryResult[]): CategoryMetrics {
    const groupLlm = group
      .map((r) => r.llm_judge_score)
      .filter((s): s is number => s !== null && s > 0);
    const groupFaith = group
      .map((r) => r.faithfulness_score)
      .filter((s): s is number => s !== null && s > 0);
    return {
      count: group.length,
      recall_at_k: avg(group.map((r) => r.recall_at_k)),
      precision_at_k: avg(group.map((r) => r.precision_at_k)),
      mrr: avg(group.map((r) => r.reciprocal_rank)),
      factual_containment: avg(group.map((r) => r.factual_containment)),
      citation_accuracy: avg(group.map((r) => r.citation_accuracy)),
      llm_judge_avg: groupLlm.length > 0 ? avg(groupLlm) : null,
      faithfulness_avg: groupFaith.length > 0 ? avg(groupFaith) : null,
    };
  }

  const categoryMetrics: Record<string, CategoryMetrics> = {};
  for (const [cat, group] of Object.entries(byCategory)) {
    categoryMetrics[cat] = computeGroupMetrics(group);
  }
  const difficultyMetrics: Record<string, CategoryMetrics> = {};
  for (const [diff, group] of Object.entries(byDifficulty)) {
    difficultyMetrics[diff] = computeGroupMetrics(group);
  }

  return {
    total_queries: total,
    recall_at_k: avg(results.map((r) => r.recall_at_k)),
    precision_at_k: avg(results.map((r) => r.precision_at_k)),
    mrr: avg(results.map((r) => r.reciprocal_rank)),
    factual_containment: avg(results.map((r) => r.factual_containment)),
    citation_accuracy: avg(results.map((r) => r.citation_accuracy)),
    llm_judge_avg: llmScores.length > 0 ? avg(llmScores) : null,
    faithfulness_avg: faithScores.length > 0 ? avg(faithScores) : null,
    avg_latency_ms: avg(results.map((r) => r.latency_ms)),
    p95_latency_ms: pct(results.map((r) => r.latency_ms), 0.95),
    p99_latency_ms: pct(results.map((r) => r.latency_ms), 0.99),
    max_latency_ms: Math.max(...results.map((r) => r.latency_ms)),
    by_category: categoryMetrics,
    by_difficulty: difficultyMetrics,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Validate required env vars
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
  // Need either password auth OR service role key + email for impersonation
  if (!SUPABASE_SERVICE_ROLE_KEY && (!EVAL_USER_EMAIL || !EVAL_USER_PASSWORD)) {
    missing.push("EVAL_USER_PASSWORD (or set SUPABASE_SERVICE_ROLE_KEY for OAuth users)");
  }
  if (!EVAL_USER_EMAIL) missing.push("EVAL_USER_EMAIL");
  if (missing.length > 0) {
    logError(`Missing required env vars: ${missing.join(", ")}`);
    logError("See file header for usage instructions.");
    Deno.exit(1);
  }

  if (!ANTHROPIC_API_KEY && (!SKIP_LLM_JUDGE || !SKIP_FAITHFULNESS)) {
    log("Warning: ANTHROPIC_API_KEY not set. LLM-as-judge and faithfulness will be skipped.");
    log("Set EVAL_SKIP_LLM_JUDGE=true and EVAL_SKIP_FAITHFULNESS=true to suppress this warning.");
  }

  // 1. Load golden dataset
  log(`Loading golden dataset from ${DATASET_PATH}...`);
  let dataset: GoldenDataset;
  try {
    const raw = await Deno.readTextFile(DATASET_PATH);
    dataset = JSON.parse(raw);
  } catch (err) {
    logError(`Failed to load golden dataset: ${err}`);
    Deno.exit(1);
  }

  // Validate dataset — check for placeholder doc IDs
  const placeholderQueries = dataset.queries.filter((q) =>
    q.expected_doc_ids.some((id) => id.startsWith("REPLACE_WITH_"))
  );
  if (placeholderQueries.length > 0) {
    logError(
      `${placeholderQueries.length} queries still have placeholder doc IDs. ` +
        `Replace 'REPLACE_WITH_...' values with real document_id values from your database.`,
    );
    logError(`Queries with placeholders: ${placeholderQueries.map((q) => q.id).join(", ")}`);
    Deno.exit(1);
  }

  log(`Loaded ${dataset.queries.length} queries (v${dataset.version})`);

  // 2. Authenticate as test user
  log("Authenticating as eval user...");
  let accessToken: string;

  if (EVAL_USER_PASSWORD) {
    // Standard password auth
    const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: EVAL_USER_EMAIL!,
      password: EVAL_USER_PASSWORD!,
    });
    if (authError || !authData.session) {
      logError(`Authentication failed: ${authError?.message || "No session returned"}`);
      Deno.exit(1);
    }
    accessToken = authData.session.access_token;
    log(`Authenticated as ${EVAL_USER_EMAIL} (user_id: ${authData.user?.id})`);
  } else {
    // Service role impersonation for OAuth-only users
    log("Using service role key to generate user session...");
    const adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const { data: userList, error: listError } = await adminClient.auth.admin.listUsers();
    if (listError) {
      logError(`Failed to list users: ${listError.message}`);
      Deno.exit(1);
    }
    const targetUser = userList.users.find((u: { email?: string }) => u.email === EVAL_USER_EMAIL);
    if (!targetUser) {
      logError(`User not found: ${EVAL_USER_EMAIL}`);
      Deno.exit(1);
    }
    // Generate a link to get a valid session for this user
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: EVAL_USER_EMAIL!,
    });
    if (linkError || !linkData) {
      logError(`Failed to generate link: ${linkError?.message}`);
      Deno.exit(1);
    }
    // The hashed_token can be used to verify OTP and get a session
    const { data: verifyData, error: verifyError } = await adminClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });
    if (verifyError || !verifyData.session) {
      logError(`Failed to verify OTP: ${verifyError?.message}`);
      Deno.exit(1);
    }
    accessToken = verifyData.session.access_token;
    log(`Authenticated as ${EVAL_USER_EMAIL} (user_id: ${targetUser.id}) via service role`);
  }

  // 3. Run queries
  const functionUrl = `${SUPABASE_URL}/functions/v1/search-documents`;
  const results: QueryResult[] = [];
  let completed = 0;

  log(`Running ${dataset.queries.length} queries (concurrency: ${CONCURRENCY}, K=${K})...`);
  log("─".repeat(60));

  await pooled(dataset.queries, CONCURRENCY, async (gq, _idx) => {
    const start = performance.now();
    let searchResponse: SearchResponse;

    try {
      const res = await fetch(functionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({
          query: gq.query,
          threshold: PIPELINE_CONFIG.match_threshold,
          ...(PROMPT_VERSION !== undefined && { prompt_version: PROMPT_VERSION }),
          ...(QE_VERSION !== undefined && { qe_version: QE_VERSION }),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        logError(`Query ${gq.id} HTTP ${res.status}: ${errText}`);
        searchResponse = { answer: "", sources: [], query: gq.query, error: errText };
      } else {
        searchResponse = await res.json();
      }
    } catch (err) {
      logError(`Query ${gq.id} network error: ${err}`);
      searchResponse = { answer: "", sources: [], query: gq.query, error: String(err) };
    }

    const latencyMs = Math.round(performance.now() - start);
    const retrievedDocIds = searchResponse.sources.map((s) => s.document_id);

    // Compute retrieval metrics
    const recallAtK = computeRecallAtK(gq.expected_doc_ids, retrievedDocIds, K);
    const precisionAtK = computePrecisionAtK(gq.expected_doc_ids, retrievedDocIds, K);
    const reciprocalRank = computeReciprocalRank(gq.expected_doc_ids, retrievedDocIds);

    // Compute answer quality metrics
    const factual = computeFactualContainment(gq.expected_answer_contains, searchResponse.answer);
    const citationAcc = computeCitationAccuracy(gq.expected_doc_ids, searchResponse.sources);

    // LLM-as-judge (optional)
    let llmScore: number | null = null;
    let llmExplanation: string | null = null;
    if (!SKIP_LLM_JUDGE && ANTHROPIC_API_KEY) {
      const judgeResult = await llmJudge(gq.query, gq.expected_answer_contains, searchResponse.answer);
      if (judgeResult.score > 0) {
        llmScore = judgeResult.score;
        llmExplanation = judgeResult.explanation;
      }
    }

    // Faithfulness (optional)
    let faithScore: number | null = null;
    let faithExplanation: string | null = null;
    let faithClaims: { claim: string; verdict: string; evidence: string }[] | null = null;
    if (!SKIP_FAITHFULNESS && ANTHROPIC_API_KEY) {
      const chunks = searchResponse.sources.map((s) => s.chunk_text);
      const faithResult = await faithfulnessJudge(gq.query, searchResponse.answer, chunks);
      if (faithResult.score > 0) {
        faithScore = faithResult.score;
        faithExplanation = faithResult.explanation;
        faithClaims = faithResult.claims.length > 0 ? faithResult.claims : null;
      }
    }

    completed++;
    const faithLabel = faithScore !== null ? ` F=${(faithScore / 5).toFixed(2)}` : "";
    const status = recallAtK >= 0.8 ? "✓" : recallAtK > 0 ? "~" : "✗";
    log(
      `  ${status} [${completed}/${dataset.queries.length}] ${gq.id} (${gq.category}) ` +
        `R@${K}=${recallAtK.toFixed(2)} P@${K}=${precisionAtK.toFixed(2)} ` +
        `FC=${factual.score.toFixed(2)}${faithLabel} ${latencyMs}ms`,
    );

    results.push({
      query_id: gq.id,
      query: gq.query,
      category: gq.category,
      difficulty: gq.difficulty,
      answer: searchResponse.answer,
      sources: searchResponse.sources,
      latency_ms: latencyMs,
      expected_doc_ids: gq.expected_doc_ids,
      retrieved_doc_ids: retrievedDocIds,
      recall_at_k: recallAtK,
      precision_at_k: precisionAtK,
      reciprocal_rank: reciprocalRank,
      factual_containment: factual.score,
      expected_phrases_found: factual.found,
      expected_phrases_missing: factual.missing,
      citation_accuracy: citationAcc,
      llm_judge_score: llmScore,
      llm_judge_explanation: llmExplanation,
      faithfulness_score: faithScore,
      faithfulness_explanation: faithExplanation,
      faithfulness_claims: faithClaims,
    });
  });

  // Sort results by query ID for consistent ordering
  results.sort((a, b) => a.query_id.localeCompare(b.query_id));

  // 4. Compute aggregates
  log("─".repeat(60));
  log("Computing aggregate metrics...");
  const aggregate = aggregateResults(results);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runId = `${RUN_NAME}-${timestamp}`;

  const evalResults: EvalResults = {
    run_id: runId,
    timestamp: new Date().toISOString(),
    config: PIPELINE_CONFIG,
    aggregate,
    per_query: results,
  };

  // 5. Write results
  await Deno.mkdir(RESULTS_DIR, { recursive: true });
  const outputPath = `${RESULTS_DIR}/${runId}.json`;
  await Deno.writeTextFile(outputPath, JSON.stringify(evalResults, null, 2));
  log(`Results written to ${outputPath}`);

  // 6. Print summary
  log("");
  log("═".repeat(60));
  log("  EVALUATION SUMMARY");
  log("═".repeat(60));
  log(`  Run:                ${runId}`);
  log(`  Queries:            ${aggregate.total_queries}`);
  log(`  Latency avg/p95/p99/max: ${aggregate.avg_latency_ms.toFixed(0)} / ${aggregate.p95_latency_ms} / ${aggregate.p99_latency_ms} / ${aggregate.max_latency_ms} ms`);
  log("");
  log("  RETRIEVAL METRICS");
  log(`    Recall@${K}:         ${(aggregate.recall_at_k * 100).toFixed(1)}%`);
  log(`    Precision@${K}:      ${(aggregate.precision_at_k * 100).toFixed(1)}%`);
  log(`    MRR:              ${(aggregate.mrr * 100).toFixed(1)}%`);
  log("");
  log("  ANSWER QUALITY");
  log(`    Factual contain:  ${(aggregate.factual_containment * 100).toFixed(1)}%`);
  log(`    Citation accuracy:${(aggregate.citation_accuracy * 100).toFixed(1)}%`);
  if (aggregate.llm_judge_avg !== null) {
    log(`    LLM judge avg:    ${aggregate.llm_judge_avg.toFixed(2)}/5`);
  }
  if (aggregate.faithfulness_avg !== null) {
    log(`    Faithfulness avg: ${aggregate.faithfulness_avg.toFixed(2)}/5`);
  }
  log("");
  log("  BY CATEGORY");
  for (const [cat, metrics] of Object.entries(aggregate.by_category)) {
    log(
      `    ${cat.padEnd(22)} n=${metrics.count} R@${K}=${(metrics.recall_at_k * 100).toFixed(0)}% ` +
        `FC=${(metrics.factual_containment * 100).toFixed(0)}%`,
    );
  }
  log("");
  log("  BY DIFFICULTY");
  for (const [diff, metrics] of Object.entries(aggregate.by_difficulty)) {
    log(
      `    ${diff.padEnd(22)} n=${metrics.count} R@${K}=${(metrics.recall_at_k * 100).toFixed(0)}% ` +
        `FC=${(metrics.factual_containment * 100).toFixed(0)}%`,
    );
  }
  log("═".repeat(60));

  log("Done.");
}

main();
