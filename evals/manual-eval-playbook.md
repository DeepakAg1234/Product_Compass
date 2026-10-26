# Manual RAG Eval Playbook

A step-by-step process to evaluate PM Compass search quality by hand using the product UI and a Google Sheet. Complements the automated harness (`run-evals.ts`) with qualitative insight into retrieval and synthesis quality.

**Why manual eval?**
- Builds intuition about what good/bad retrieval looks like
- Spots failure modes aggregate numbers hide (right doc, wrong section; hallucinated facts)
- No env vars, no CLI — just the product + a spreadsheet
- Great learning exercise for understanding RAG eval fundamentals

---

## Table of Contents

1. [Google Sheet Setup](#1-google-sheet-setup)
2. [Tab 1: Query Reference](#tab-1-query-reference)
3. [Tab 2: Results](#tab-2-results)
4. [Tab 3: Metrics](#tab-3-metrics)
5. [Tab 4: Comparison](#tab-4-comparison)
6. [All 50 Queries](#2-all-50-queries)
7. [Quick Start: 10-Query Subset](#3-quick-start-10-query-subset)
8. [Step-by-Step Recording Process](#4-step-by-step-recording-process)
9. [Negative Query Handling](#5-negative-query-handling)
10. [Interpreting Results](#6-interpreting-results)
11. [Automated Baseline Reference](#7-automated-baseline-reference)

---

## 1. Google Sheet Setup

Create a Google Sheet with 4 tabs: **Query Reference**, **Results**, **Metrics**, **Comparison**.

### Tab 1: Query Reference

Pre-populated lookup table. No manual entry needed — copy-paste from the query table below.

| Column | Content |
|--------|---------|
| A: Query ID | q01 – q50 |
| B: Query Text | The search query to type into PM Compass |
| C: Category | exact_lookup, factual_extraction, tabular_statistical, paraphrase, cross_document, negative, vague_broad |
| D: Difficulty | easy, medium, hard |
| E: Expected Doc 1 | Symbolic name (e.g., ROADMAP_2025) |
| F: Expected Doc 2 | (blank if only 1 expected) |
| G: Expected Doc 3 | (blank if <3 expected) |
| H: Expected Doc 4 | (blank if <4 expected) |
| I: # Expected Docs | Count of expected docs |
| J: Expected Phrase 1 | First phrase to look for in answer |
| K: Expected Phrase 2 | Second phrase |
| L: Expected Phrase 3 | Third phrase |
| M: # Expected Phrases | Count of expected phrases |
| N: Notes | What this query tests |

### Tab 2: Results

Where you record what PM Compass returns.

| Column | Content | How to Fill |
|--------|---------|-------------|
| A: Query ID | `='Query Reference'!A2` | Auto-filled (drag down) |
| B: Query Text | `='Query Reference'!B2` | Auto-filled |
| C: Result 1 Title | Title of 1st source doc returned | Copy from PM Compass UI |
| D: Result 1 Match? | Is this doc in the expected list? | Type `Y` or `N` |
| E: Result 2 Title | Title of 2nd source doc | Copy from UI |
| F: Result 2 Match? | Y/N | Manual |
| G: Result 3 Title | Title of 3rd source doc | Copy from UI |
| H: Result 3 Match? | Y/N | Manual |
| I: Result 4 Title | Title of 4th source doc | Copy from UI |
| J: Result 4 Match? | Y/N | Manual |
| K: Result 5 Title | Title of 5th source doc | Copy from UI |
| L: Result 5 Match? | Y/N | Manual |
| M: # Results Returned | How many source docs shown | Count from UI |
| N: Answer Text | The AI-synthesized answer | Copy-paste from UI |
| O: Phrase 1 Found? | Does answer contain expected phrase 1? | Y/N (Ctrl+F in the answer) |
| P: Phrase 2 Found? | Y/N | Manual |
| Q: Phrase 3 Found? | Y/N | Manual |
| R: Qualitative Notes | Anything you notice | Free text |

### Tab 3: Metrics

Auto-computed from Results and Query Reference tabs. All formulas reference row 2 — drag down to row 51.

| Column | Header | Formula (row 2) |
|--------|--------|-----------------|
| A | Query ID | `=Results!A2` |
| B | Category | `='Query Reference'!C2` |
| C | Difficulty | `='Query Reference'!D2` |
| D | Recall@5 | `=IF('Query Reference'!I2=0, 1, COUNTIF(Results!D2,"Y",Results!F2,"Y",Results!H2,"Y",Results!J2,"Y",Results!L2,"Y") / 'Query Reference'!I2)` |
| E | Precision@5 | `=IF('Query Reference'!I2=0, IF(Results!M2=0, 1, 0), COUNTIF(Results!D2,"Y",Results!F2,"Y",Results!H2,"Y",Results!J2,"Y",Results!L2,"Y") / MAX(Results!M2, 1))` |
| F | Reciprocal Rank | See formula below |
| G | Factual Containment | `=IF('Query Reference'!M2=0, 1, COUNTIF(Results!O2,"Y",Results!P2,"Y",Results!Q2,"Y") / 'Query Reference'!M2)` |
| H | Citation Accuracy | `=D2` (same as Recall@5 in this setup) |

**COUNTIF note:** Google Sheets `COUNTIF` only takes one range. Use this instead:

```
=COUNTIFS(Results!D2,"Y") + COUNTIFS(Results!F2,"Y") + COUNTIFS(Results!H2,"Y") + COUNTIFS(Results!J2,"Y") + COUNTIFS(Results!L2,"Y")
```

So the actual **Recall@5** formula for row 2 is:
```
=IF('Query Reference'!I2=0, 1,
  (COUNTIFS(Results!D2,"Y") + COUNTIFS(Results!F2,"Y") + COUNTIFS(Results!H2,"Y") + COUNTIFS(Results!J2,"Y") + COUNTIFS(Results!L2,"Y"))
  / 'Query Reference'!I2)
```

**Precision@5** formula:
```
=IF('Query Reference'!I2=0,
  IF(Results!M2=0, 1, 0),
  (COUNTIFS(Results!D2,"Y") + COUNTIFS(Results!F2,"Y") + COUNTIFS(Results!H2,"Y") + COUNTIFS(Results!J2,"Y") + COUNTIFS(Results!L2,"Y"))
  / MAX(Results!M2, 1))
```

**Factual Containment** formula:
```
=IF('Query Reference'!M2=0, 1,
  (COUNTIFS(Results!O2,"Y") + COUNTIFS(Results!P2,"Y") + COUNTIFS(Results!Q2,"Y"))
  / 'Query Reference'!M2)
```

**Reciprocal Rank** formula:
```
=IF(Results!D2="Y", 1,
  IF(Results!F2="Y", 0.5,
    IF(Results!H2="Y", 1/3,
      IF(Results!J2="Y", 0.25,
        IF(Results!L2="Y", 0.2, 0)))))
```

#### Aggregate Metrics (row 52)

```
Avg Recall@5:            =AVERAGE(D2:D51)
Avg Precision@5:         =AVERAGE(E2:E51)
MRR:                     =AVERAGE(F2:F51)
Avg Factual Containment: =AVERAGE(G2:G51)
Avg Citation Accuracy:   =AVERAGE(H2:H51)
```

#### By-Category Averages (rows 54-60)

```
exact_lookup Recall@5:         =AVERAGEIF(B2:B51, "exact_lookup", D2:D51)
factual_extraction Recall@5:   =AVERAGEIF(B2:B51, "factual_extraction", D2:D51)
tabular_statistical Recall@5:  =AVERAGEIF(B2:B51, "tabular_statistical", D2:D51)
paraphrase Recall@5:           =AVERAGEIF(B2:B51, "paraphrase", D2:D51)
cross_document Recall@5:       =AVERAGEIF(B2:B51, "cross_document", D2:D51)
negative Recall@5:             =AVERAGEIF(B2:B51, "negative", D2:D51)
vague_broad Recall@5:          =AVERAGEIF(B2:B51, "vague_broad", D2:D51)
```

Replace column `D` with `G` for Factual Containment by category. Same pattern for other metrics.

#### By-Difficulty Averages (rows 62-64)

```
easy Recall@5:    =AVERAGEIF(C2:C51, "easy", D2:D51)
medium Recall@5:  =AVERAGEIF(C2:C51, "medium", D2:D51)
hard Recall@5:    =AVERAGEIF(C2:C51, "hard", D2:D51)
```

### Tab 4: Comparison

| Row | A: Metric | B: Manual Result | C: Automated Baseline | D: Delta |
|-----|-----------|-----------------|----------------------|----------|
| 2 | Recall@5 | `=Metrics!D52` | 0.833 | `=B2-C2` |
| 3 | Precision@5 | `=Metrics!E52` | 0.264 | `=B3-C3` |
| 4 | MRR | `=Metrics!F52` | 0.768 | `=B4-C4` |
| 5 | Factual Containment | `=Metrics!G52` | 0.553 | `=B5-C5` |
| 6 | Citation Accuracy | `=Metrics!H52` | 0.760 | `=B6-C6` |

---

## 2. All 50 Queries

Copy-paste this table into Tab 1 (Query Reference). Each row is one eval query.

### exact_lookup (q01-q06) — Easy

| ID | Query | Difficulty | Expected Docs | Expected Phrases | Notes |
|----|-------|-----------|---------------|-----------------|-------|
| q01 | Find the 2025 product roadmap | easy | ROADMAP_2025 | roadmap, 2025 | Direct title match |
| q02 | Show me the churn analysis | easy | CHURN_Q3Q4, CHURN_Q1Q2 | churn | Should find both churn sheets |
| q03 | Where is the competitor analysis for AcmeSaaS? | easy | COMPETITOR_ACME | AcmeSaaS | Direct title/content match |
| q04 | Find the API specification document | easy | API_SPEC | API, v2 | Direct title match |
| q05 | Show me the Smart Alerts launch checklist | easy | SMART_ALERTS_CHECKLIST | Smart Alerts, checklist | Direct title match |
| q06 | Find the Data Export PRD | easy | DATA_EXPORT_PRD | Data Export | Direct title match |

### factual_extraction (q07-q18) — Medium

| ID | Query | Difficulty | Expected Docs | Expected Phrases | Notes |
|----|-------|-----------|---------------|-----------------|-------|
| q07 | What was our MRR in October 2025? | medium | MRR_2025 | 1,173,608 / 1173608 / 1.17 | Oct 2025 total MRR |
| q08 | What are AcmeSaaS's main product strengths? | medium | COMPETITOR_ACME | mobile, AI | Strengths: mobile experience + GA AI features |
| q09 | What were the action items from the November 15 product-eng sync? | medium | SYNC_NOV15 | AI Copilot, error rate | Jake to reduce AI Copilot error rate to <3% |
| q10 | What API authentication methods does RavenStack support? | medium | API_SPEC | OAuth, API Key | OAuth 2.0 and API Keys for Enterprise |
| q11 | What did users say about the onboarding experience? | medium | UX_ONBOARDING | 45 minutes, overwhelmed | Time-to-value 45 min, users feel overwhelmed |
| q12 | What's the current error rate for AI Copilot? | medium | BETA_FEATURES, SYNC_NOV15, ROADMAP_2025 | 7.2 | 7.2% error rate across multiple docs |
| q13 | How many Enterprise accounts does RavenStack have? | medium | ENTERPRISE_DEEP_DIVE, ACCT_SEGMENTATION | 154 | 154 Enterprise accounts |
| q14 | What are the remaining items on the Smart Alerts launch checklist? | medium | SMART_ALERTS_CHECKLIST | error rate, 3%, Slack | 8 unchecked items |
| q15 | What is our trial-to-paid conversion rate? | medium | TRIAL_CONVERSION | 100% | 100% conversion rate |
| q16 | What's the average customer satisfaction score for support? | medium | SUPPORT_2025 | 3.98 | Avg CSAT across 2025 |
| q17 | What is the proposed customer health score framework? | medium | HEALTH_SCORE | feature engagement, support health | 4 components: engagement (40%), support (25%), usage (20%), contract (15%) |
| q18 | What pricing options are being considered for churn reduction? | medium | PRICING_REVIEW | annual, discount, 30% | Option C: increase annual discount 20%→30% |

### tabular_statistical (q19-q26) — Mixed difficulty

| ID | Query | Difficulty | Expected Docs | Expected Phrases | Notes |
|----|-------|-----------|---------------|-----------------|-------|
| q19 | Which plan tier has the highest churn? | medium | CHURN_Q3Q4, CHURN_Q1Q2, CHURN_INITIATIVE | features, budget | Top reasons: features (114), support (104), budget (104) |
| q20 | What was the MRR growth from January to December 2025? | medium | MRR_2025 | 273, 2,273, 8.3x | $273K → $2,273K |
| q21 | Compare H1 and H2 2025 support ticket volumes | medium | SUPPORT_H1H2 | 490, 518 | H1: 490, H2: 518 (+5.7%) |
| q22 | What are the top 3 most used features in 2025? | medium | FEATURE_ADOPTION | Inbox Zero, Notification Center, Integrations Hub | Top 3 by usage count |
| q23 | How many churn events happened in Q4 2025? | easy | CHURN_Q3Q4 | 251 | 251 events |
| q24 | What percentage of total MRR comes from Enterprise accounts? | medium | MRR_2025, ENTERPRISE_DEEP_DIVE | 72, 73 | 72.7% of Dec 2025 MRR |
| q25 | Which month had the worst CSAT score in 2025? | hard | SUPPORT_2025 | March, 3.73 | March 2025 = 3.73 |
| q26 | What's the total refund amount for Q4 2025? | medium | CHURN_Q3Q4 | 3,710 / 3710 | $3,710.32 |

### paraphrase (q27-q31) — Tests semantic understanding

| ID | Query | Difficulty | Expected Docs | Expected Phrases | Notes |
|----|-------|-----------|---------------|-----------------|-------|
| q27 | Show me the product requirements document | medium | DATA_EXPORT_PRD, ROADMAP_2025 | Data Export, roadmap | "PRD" → Data Export PRD + Roadmap |
| q28 | What's our competitive positioning? | medium | COMPETITOR_ACME, COMPETITOR_NIMBUS | AcmeSaaS, NimbusApp | Paraphrase → competitor analysis docs |
| q29 | Show me the revenue dashboard | medium | MRR_2025 | MRR | "Revenue dashboard" → MRR sheet |
| q30 | What's our customer retention situation? | hard | NRR_ANALYSIS, CHURN_INITIATIVE, HEALTH_SCORE | churn, retention | Retention → NRR + churn + health score |
| q31 | Find the user interview findings | medium | UX_ONBOARDING, UX_POWER_USER, UX_ENTERPRISE_PERSONAS | user research, interview | Should map to all 3 UX research docs |

### cross_document (q32-q38, q49-q50) — Hard, requires synthesis

| ID | Query | Difficulty | Expected Docs | Expected Phrases | Notes |
|----|-------|-----------|---------------|-----------------|-------|
| q32 | How do our AI features affect churn? | hard | BETA_FEATURES, CHURN_INITIATIVE, SYNC_NOV15 | AI Copilot, error rate, features | Connect: beta errors + feature churn + Nov sync |
| q33 | What's the relationship between support tickets and churn? | hard | HEALTH_SCORE, CHURN_INITIATIVE, SUPPORT_2025 | 3+, urgent, 4x | 3+ urgent tickets = 4x churn rate |
| q34 | What progress was made on action items between the October and December sync meetings? | hard | SYNC_OCT4, SYNC_NOV15, SYNC_DEC6 | AI Search, Video Conferencing | Track items across 3 meetings |
| q35 | How does our Enterprise account distribution compare across verticals and what are the retention risks? | hard | ENTERPRISE_DEEP_DIVE, UX_ENTERPRISE_PERSONAS, CHURN_INITIATIVE | FinTech, DevTools, 154 | Enterprise data + personas + churn |
| q36 | What do power users think about the Data Export feature and what's planned? | hard | UX_POWER_USER, DATA_EXPORT_PRD | JSON, API, 3,306 | Power user interviews + PRD |
| q37 | What are all the 2026 strategic priorities mentioned across documents? | hard | ROADMAP_2025, CHURN_INITIATIVE, PRICING_REVIEW | churn, AI, international | Cross-doc synthesis of 2026 priorities |
| q38 | Compare 2024 and 2025 MRR performance year-over-year | hard | MRR_2025, MRR_2024 | 4,684; 273; 279,863; 2,273 | YoY comparison from both sheets |
| q49 | What's the NimbusApp competitive threat to our DevTools accounts? | hard | COMPETITOR_NIMBUS, ENTERPRISE_DEEP_DIVE, ACCT_SEGMENTATION | NimbusApp, DevTools, 113 | Connect competitor + account data |
| q50 | How should we improve onboarding for Enterprise customers? | hard | UX_ONBOARDING, UX_ENTERPRISE_PERSONAS, CS_PLAYBOOK | onboarding, vertical, role | Onboarding research + personas + CS playbook |

### negative (q39-q43) — Should return "not found"

| ID | Query | Difficulty | Expected Docs | Notes |
|----|-------|-----------|---------------|-------|
| q39 | What's our AWS infrastructure cost? | easy | (none) | No AWS data — should say not found |
| q40 | What's the company's vacation policy? | easy | (none) | No HR policy docs |
| q41 | What was discussed about the mobile app in last week's meeting? | medium | (none) | Competitors mention mobile, but no meeting about it |
| q42 | What are the Kubernetes deployment configurations? | easy | (none) | No infrastructure docs |
| q43 | What was the outcome of the Series B fundraise? | medium | (none) | Investor FAQ exists but no Series B specifics |

### vague_broad (q44-q48) — Tests recall breadth

| ID | Query | Difficulty | Expected Docs | Expected Phrases | Notes |
|----|-------|-----------|---------------|-----------------|-------|
| q44 | Strategy documents | hard | ROADMAP_2025, COMPETITOR_ACME, PRICING_REVIEW, CHURN_INITIATIVE | (none) | Should surface strategic docs |
| q45 | Recent meeting notes | hard | SYNC_DEC6, SYNC_NOV15, SYNC_OCT4 | sync, meeting | Should surface sync notes |
| q46 | Analytics and metrics | hard | MRR_2025, FEATURE_ADOPTION, SUPPORT_2025, CHURN_Q3Q4 | (none) | Should surface data-heavy sheets |
| q47 | User research | medium | UX_ONBOARDING, UX_POWER_USER, UX_ENTERPRISE_PERSONAS | research, interview | Should match all 3 UX docs |
| q48 | AI features | medium | BETA_FEATURES, ROADMAP_2025, SMART_ALERTS_CHECKLIST | AI | Beta deep dive most relevant |

---

## 3. Quick Start: 10-Query Subset

For a fast first pass covering all 7 categories and 3 difficulty levels:

| # | ID | Query | Category | Difficulty |
|---|-----|-------|----------|-----------|
| 1 | q01 | Find the 2025 product roadmap | exact_lookup | easy |
| 2 | q07 | What was our MRR in October 2025? | factual_extraction | medium |
| 3 | q23 | How many churn events happened in Q4 2025? | tabular_statistical | easy |
| 4 | q29 | Show me the revenue dashboard | paraphrase | medium |
| 5 | q30 | What's our customer retention situation? | paraphrase | hard |
| 6 | q35 | How does our Enterprise account distribution compare across verticals and what are the retention risks? | cross_document | hard |
| 7 | q37 | What are all the 2026 strategic priorities mentioned across documents? | cross_document | hard |
| 8 | q39 | What's our AWS infrastructure cost? | negative | easy |
| 9 | q08 | What are AcmeSaaS's main product strengths? | factual_extraction | medium |
| 10 | q47 | User research | vague_broad | medium |

---

## 4. Step-by-Step Recording Process

### For Each Query

1. Go to **pmcompass.vercel.app** → sign in → Search page
2. **Copy-paste** the query exactly as written from Tab 1 column B
3. Wait for results to load
4. In the **Results** tab, record:
   - Titles of the source documents shown (in order, up to 5)
   - For each doc: mark `Y` if it matches any expected doc in Tab 1, `N` otherwise
   - Copy the full AI-synthesized answer text
   - For each expected phrase: Ctrl+F / Cmd+F in the answer, mark `Y` or `N`
5. (Optional) Add qualitative notes in column R:
   - "Answer was good but missed the pricing detail"
   - "Returned right doc but summarized wrong section"
   - "Hallucinated a number not in any source"
   - "Said 'I don't have information' — correct for negative query"

### After All Queries

1. Switch to **Tab 3 (Metrics)** — formulas compute everything automatically
2. Review the **aggregate row** (row 52) for overall scores
3. Check **by-category** and **by-difficulty** breakdowns
4. Go to **Tab 4 (Comparison)** to see delta vs. automated baseline
5. Sort by Recall@5 ascending to find the worst-performing queries

---

## 5. Negative Query Handling

For negative queries (q39-q43), the expected doc list is empty. Scoring rules:

| Metric | Rule |
|--------|------|
| Recall@5 | Always 1.0 (nothing to miss) |
| Precision@5 | 1.0 if system returns 0 results, 0.0 if it returns anything |
| Factual Containment | Always 1.0 (no phrases expected) |

**What to watch for manually:**
- Does the answer say "I don't have information about this"? → Good
- Does it hallucinate an answer from tangentially related docs? → Bad, note it
- Does it return source docs that aren't relevant? → Note which ones

---

## 6. Interpreting Results

### What Good Looks Like

| Metric | Good | Acceptable | Needs Work |
|--------|------|-----------|------------|
| Recall@5 | >90% | 75-90% | <75% |
| Precision@5 | >30% | 20-30% | <20% |
| MRR | >80% | 60-80% | <60% |
| Factual Containment | >70% | 50-70% | <50% |

### Common Failure Patterns

| Pattern | What You See | Likely Cause |
|---------|-------------|-------------|
| Right doc, wrong rank | Expected doc at position 3-5, not 1 | Embedding similarity not differentiating well |
| Right doc, wrong answer | Correct source but answer misses key fact | Chunk boundary split the relevant info |
| Wrong doc, plausible answer | Unrelated doc but answer sounds reasonable | Hallucination — model is confabulating |
| No results for valid query | "I don't have information" for a query that should match | Query phrasing too different from doc language |
| Too many results for negative | Returns 5 docs for a query about nonexistent topic | Threshold too low (currently 0.3) |

### Manual vs. Automated Delta

| Delta | Interpretation |
|-------|---------------|
| Manual ≈ Automated (±5%) | System is consistent — UI matches backend |
| Manual < Automated | UI might truncate results, or you're stricter on matching |
| Manual > Automated | You're more generous on matching, or automated has a bug |

---

## 7. Automated Baseline Reference

From run `baseline-2026-03-06T20-27-04`:

```
Overall:
  Recall@5:            83.3%
  Precision@5:         26.4%
  MRR:                 76.8%
  Factual Containment: 55.3%
  Citation Accuracy:   76.0%

By Category:
  exact_lookup           R@5=100%   FC=100%
  factual_extraction     R@5=89%    FC=64%
  tabular_statistical    R@5=85%    FC=50%
  paraphrase             R@5=83%    FC=20%
  cross_document         R@5=74%    FC=22%
  negative               R@5=100%   FC=100%
  vague_broad            R@5=47%    FC=40%

By Difficulty:
  easy                   R@5=100%   FC=90%
  medium                 R@5=85%    FC=54%
  hard                   R@5=64%    FC=29%
```

---

## Doc ID → Symbolic Name Mapping

Use this to identify which expected doc a returned result matches. The "Title" column is what you'll see in the PM Compass UI.

| Symbolic Name | Document Title (in PM Compass) |
|---------------|-------------------------------|
| ROADMAP_2025 | RavenStack Product Roadmap 2025 |
| ROADMAP_2024 | RavenStack Product Roadmap 2024 |
| COMPETITOR_ACME | Competitive Analysis: AcmeSaaS |
| COMPETITOR_NIMBUS | Competitive Analysis: NimbusApp |
| SYNC_NOV15 | Product-Eng Sync — November 15, 2025 |
| SYNC_DEC6 | Product-Eng Sync — December 6, 2025 |
| SYNC_OCT4 | Product-Eng Sync — October 4, 2025 |
| MRR_2025 | MRR & Subscription Dashboard 2025 |
| MRR_2024 | MRR & Subscription Dashboard 2024 |
| CHURN_Q3Q4 | Churn & Cancellation Analysis Q3-Q4 2025 |
| CHURN_Q1Q2 | Churn & Cancellation Analysis Q1-Q2 2025 |
| FEATURE_ADOPTION | Feature Adoption & Usage Analytics 2025 |
| BETA_FEATURES | Beta Features Deep Dive 2025 |
| SUPPORT_2025 | Support Ticket Analytics 2025 |
| SUPPORT_H1H2 | Support Ticket Analytics H1 vs H2 2025 |
| ACCT_SEGMENTATION | Account Segmentation Analysis 2025 |
| ENTERPRISE_DEEP_DIVE | Enterprise Account Deep Dive 2025 |
| TRIAL_CONVERSION | Trial-to-Paid Conversion Analysis 2025 |
| UX_ONBOARDING | UX Research: New User Onboarding |
| UX_POWER_USER | UX Research: Power User Interviews |
| UX_ENTERPRISE_PERSONAS | UX Research: Enterprise Persona Study |
| API_SPEC | API Integration Spec v2 |
| SMART_ALERTS_CHECKLIST | Smart Alerts Launch Checklist |
| DATA_EXPORT_PRD | Data Export PRD |
| BOARD_DECK | Board Deck Q4 2025 |
| QBR_Q3 | QBR Q3 2025 |
| PRICING_REVIEW | Pricing Review 2025 |
| HEALTH_SCORE | Customer Health Score Framework |
| NRR_ANALYSIS | Net Revenue Retention Analysis 2025 |
| CHURN_INITIATIVE | Churn Reduction Initiative 2026 |
| ALLHANDS_DEC | All-Hands Meeting — December 2025 |
| ALLHANDS_SEP | All-Hands Meeting — September 2025 |
| ENG_OKRS | Engineering OKRs Q1 2026 |
| DESIGN_SYSTEM | Design System v3 Documentation |
| CS_PLAYBOOK | Customer Success Playbook |
| BRAND_GUIDELINES | Brand Guidelines 2025 |
| SALES_OBJECTIONS | Sales Objection Handling Guide |
| HIRING_PLAN | 2026 Hiring Plan |
| SNACK_BUDGET | Office Snack Budget Q4 2025 |
| MARKETING_Q4 | Marketing Campaign Report Q4 2025 |
| EMPLOYEE_SURVEY | Employee Engagement Survey 2025 |
| SECURITY_CHECKLIST | Security Compliance Checklist |
| INVESTOR_FAQ | Investor FAQ 2025 |
| PARTNER_PROGRAM | Partner Program Overview |
| DEV_SETUP | Developer Environment Setup Guide |
| HIKING_TRIP | Team Hiking Trip Planning |
| FANTASY_FOOTBALL | Office Fantasy Football League Rules |
| SOURDOUGH | Sarah's Sourdough Starter Guide |
| BOOK_CLUB | Engineering Book Club Notes |
| HOME_RENOVATION | Jake's Home Renovation Tips |
