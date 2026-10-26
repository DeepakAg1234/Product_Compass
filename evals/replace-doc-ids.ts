/**
 * Replace symbolic doc IDs in golden-dataset.json with real Google Drive document IDs.
 *
 * Connects to Supabase as the eval user, queries document_chunks for all indexed
 * document titles, maps them to symbolic IDs, and updates golden-dataset.json in place.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env evals/replace-doc-ids.ts
 *
 * Required env vars:
 *   SUPABASE_URL           - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key (bypasses RLS)
 *
 * Optional env vars:
 *   EVAL_DATASET_PATH      - Path to golden dataset (default: evals/golden-dataset.json)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Title → Symbolic ID mapping ─────────────────────────────────────────────
// Exact document titles as created by the Apps Script batch files.

const TITLE_TO_SYMBOL: Record<string, string> = {
  // Batch 1: Docs 1-5
  "RavenStack 2025 Product Roadmap": "ROADMAP_2025",
  "RavenStack 2024 Product Roadmap": "ROADMAP_2024",
  "Competitor Analysis: AcmeSaaS": "COMPETITOR_ACME",
  "Competitor Analysis: NimbusApp": "COMPETITOR_NIMBUS",
  "Product-Eng Sync Notes (Nov 15, 2025)": "SYNC_NOV15",

  // Batch 2: Docs 6-10
  "Product-Eng Sync Notes (Dec 6, 2025)": "SYNC_DEC6",
  "Product-Eng Sync Notes (Oct 4, 2025)": "SYNC_OCT4",
  "MRR & Subscription Dashboard (2025)": "MRR_2025",
  "MRR & Subscription Dashboard (2024)": "MRR_2024",
  "Churn Analysis Q3-Q4 2025": "CHURN_Q3Q4",

  // Batch 3: Docs 11-18
  "Churn Analysis Q1-Q2 2025": "CHURN_Q1Q2",
  "Feature Adoption Report (Full Year 2025)": "FEATURE_ADOPTION",
  "Feature Adoption: Beta Features Deep Dive": "BETA_FEATURES",
  "Support Ticket Analytics (2025)": "SUPPORT_2025",
  "Support Ticket Analytics (H1 vs H2 Comparison)": "SUPPORT_H1H2",
  "Account Segmentation Summary": "ACCT_SEGMENTATION",
  "Enterprise Account Deep Dive": "ENTERPRISE_DEEP_DIVE",
  "Trial-to-Paid Conversion Analysis": "TRIAL_CONVERSION",

  // Batch 4: Docs 19-25
  "User Research: Onboarding Findings": "UX_ONBOARDING",
  "User Research: Power User Interviews": "UX_POWER_USER",
  "User Research: Enterprise Buyer Personas": "UX_ENTERPRISE_PERSONAS",
  "API Integration Spec v2": "API_SPEC",
  "Smart Alerts Launch Checklist": "SMART_ALERTS_CHECKLIST",
  "Data Export Feature PRD": "DATA_EXPORT_PRD",
  "2025 Annual Board Deck": "BOARD_DECK",

  // Batch 5: Docs 26-35
  "Q3 2025 QBR Deck": "QBR_Q3",
  "Pricing Strategy Review": "PRICING_REVIEW",
  "Customer Health Score Framework": "HEALTH_SCORE",
  "Net Revenue Retention Analysis": "NRR_ANALYSIS",
  "Churn Reduction Initiative Proposal": "CHURN_INITIATIVE",
  "Team All-Hands Notes (Dec 2025)": "ALLHANDS_DEC",
  "Team All-Hands Notes (Sep 2025)": "ALLHANDS_SEP",
  "Engineering OKRs Q4 2025": "ENG_OKRS",
  "Design System Documentation": "DESIGN_SYSTEM",
  "Customer Success Playbook": "CS_PLAYBOOK",

  // Batch 6: Docs 36-50
  "RavenStack Brand Guidelines": "BRAND_GUIDELINES",
  "Sales Enablement: Objection Handling": "SALES_OBJECTIONS",
  "Hiring Plan 2026": "HIRING_PLAN",
  "Office Snack Budget Tracker": "SNACK_BUDGET",
  "Q4 2025 Marketing Campaign Results": "MARKETING_Q4",
  "Employee Satisfaction Survey Results": "EMPLOYEE_SURVEY",
  "IT Security Compliance Checklist": "SECURITY_CHECKLIST",
  "RavenStack Investor FAQ": "INVESTOR_FAQ",
  "Partner Program Overview": "PARTNER_PROGRAM",
  "Internal Wiki: Dev Environment Setup": "DEV_SETUP",
  "Weekend Hiking Trip Plans": "HIKING_TRIP",
  "Fantasy Football Draft Board": "FANTASY_FOOTBALL",
  "Sourdough Bread Recipe": "SOURDOUGH",
  "Book Club Reading List Q4": "BOOK_CLUB",
  "Home Renovation Budget": "HOME_RENOVATION",
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const DATASET_PATH = Deno.env.get("EVAL_DATASET_PATH") ?? "evals/golden-dataset.json";

  // Validate env vars
  const missing = [
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    Deno.exit(1);
  }

  // 1. Load golden dataset
  console.log(`Loading golden dataset from ${DATASET_PATH}...`);
  const raw = await Deno.readTextFile(DATASET_PATH);
  const dataset = JSON.parse(raw);

  // 2. Connect with service role key (bypasses RLS)
  console.log("Connecting to Supabase with service role key...");
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // 3. Query distinct (document_id, document_title) from document_chunks
  console.log("Querying indexed documents...");
  // Supabase JS defaults to 1000 rows — paginate to get all
  let allChunks: { document_id: string; document_title: string; user_id: string }[] = [];
  let from = 0;
  const PAGE = 1000;
  let totalRows = 0;
  while (true) {
    const { data: page, error: pageError, count } = await supabase
      .from("document_chunks")
      .select("document_id, document_title, user_id", { count: "exact" })
      .order("document_title")
      .range(from, from + PAGE - 1);
    if (pageError) {
      console.error(`Query failed: ${pageError.message}`);
      Deno.exit(1);
    }
    if (count !== null) totalRows = count;
    allChunks = allChunks.concat(page || []);
    if (!page || page.length < PAGE) break;
    from += PAGE;
  }
  const chunks = allChunks;
  const queryError = null;

  if (queryError) {
    console.error(`Query failed: ${queryError.message}`);
    Deno.exit(1);
  }

  console.log(`Total rows returned: ${chunks?.length}, total in DB: ${totalRows}`);

  // Deduplicate — multiple chunks per document
  const titleToDocId = new Map<string, string>();
  for (const chunk of chunks) {
    if (!titleToDocId.has(chunk.document_title)) {
      titleToDocId.set(chunk.document_title, chunk.document_id);
    }
  }

  console.log(`Found ${titleToDocId.size} unique indexed documents`);

  // 4. Build symbolic ID → real doc ID map
  const symbolToDocId = new Map<string, string>();
  const unmatchedTitles: string[] = [];
  const unmatchedSymbols: string[] = [];

  for (const [title, docId] of titleToDocId) {
    const symbol = TITLE_TO_SYMBOL[title];
    if (symbol) {
      symbolToDocId.set(symbol, docId);
    } else {
      unmatchedTitles.push(title);
    }
  }

  // Check which symbols we didn't find
  for (const symbol of Object.values(TITLE_TO_SYMBOL)) {
    if (!symbolToDocId.has(symbol)) {
      unmatchedSymbols.push(symbol);
    }
  }

  console.log(`Matched: ${symbolToDocId.size} / ${Object.keys(TITLE_TO_SYMBOL).length} documents`);

  if (unmatchedTitles.length > 0) {
    console.warn(`\nIndexed docs with no symbolic mapping (${unmatchedTitles.length}):`);
    for (const t of unmatchedTitles) console.warn(`  - "${t}"`);
  }

  if (unmatchedSymbols.length > 0) {
    console.error(`\nMissing documents — not found in index (${unmatchedSymbols.length}):`);
    for (const s of unmatchedSymbols) console.error(`  - ${s}`);
    console.error("\nThese documents may not have been created or indexed yet.");
    console.error("Proceeding with partial replacement...\n");
  }

  // 5. Update doc_id_map
  let replacedInMap = 0;
  for (const [symbol, currentVal] of Object.entries(dataset.doc_id_map)) {
    const realId = symbolToDocId.get(symbol);
    if (realId) {
      dataset.doc_id_map[symbol] = realId;
      replacedInMap++;
    }
  }
  console.log(`Updated doc_id_map: ${replacedInMap} entries`);

  // 6. Replace symbolic IDs in expected_doc_ids arrays
  let replacedInQueries = 0;
  let unresolvedRefs = 0;

  for (const query of dataset.queries) {
    query.expected_doc_ids = query.expected_doc_ids.map((symbolicId: string) => {
      const realId = symbolToDocId.get(symbolicId);
      if (realId) {
        replacedInQueries++;
        return realId;
      }
      // Leave as-is if not found (will be caught by validation)
      unresolvedRefs++;
      return symbolicId;
    });
  }
  console.log(`Replaced ${replacedInQueries} doc ID references across ${dataset.queries.length} queries`);

  if (unresolvedRefs > 0) {
    console.warn(`${unresolvedRefs} references could not be resolved (missing documents)`);
  }

  // 7. Validate — check for remaining placeholders or symbolic IDs
  const allExpectedIds = dataset.queries.flatMap((q: { expected_doc_ids: string[] }) => q.expected_doc_ids);
  const stillSymbolic = allExpectedIds.filter(
    (id: string) => id.startsWith("REPLACE_WITH_") || Object.values(TITLE_TO_SYMBOL).includes(id)
  );
  const mapPlaceholders = Object.entries(dataset.doc_id_map).filter(
    ([, v]) => v === "REPLACE_WITH_DOC_ID"
  );

  if (stillSymbolic.length === 0 && mapPlaceholders.length === 0) {
    console.log("\nAll symbolic IDs replaced successfully!");
  } else {
    if (stillSymbolic.length > 0) {
      console.warn(`\n${stillSymbolic.length} expected_doc_ids still have symbolic/placeholder values`);
    }
    if (mapPlaceholders.length > 0) {
      console.warn(`${mapPlaceholders.length} doc_id_map entries still have REPLACE_WITH_DOC_ID`);
    }
  }

  // 8. Write updated dataset
  const output = JSON.stringify(dataset, null, 2) + "\n";
  await Deno.writeTextFile(DATASET_PATH, output);
  console.log(`\nWrote updated golden dataset to ${DATASET_PATH}`);

  // Summary
  console.log("\n── Summary ──────────────────────────────────");
  console.log(`Documents matched:    ${symbolToDocId.size} / ${Object.keys(TITLE_TO_SYMBOL).length}`);
  console.log(`doc_id_map updated:   ${replacedInMap} entries`);
  console.log(`Query refs replaced:  ${replacedInQueries}`);
  console.log(`Unresolved refs:      ${unresolvedRefs}`);
  console.log(`Ready for evals:      ${stillSymbolic.length === 0 && mapPlaceholders.length === 0 ? "YES" : "NO — fix missing documents first"}`);
}

main();
