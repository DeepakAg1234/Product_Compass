# Query Expansion — Eval Analysis

**Date:** 2026-03-18
**Baseline run:** `baseline-2026-03-17T20-36-13`
**Expansion run:** `query-expansion-2026-03-18T04-58-32`

## What Was Implemented

Before embedding a query, Claude Haiku generates 2 alternative phrasings. All 3 queries (original + 2 variants) are embedded and searched in parallel. Results are merged and deduplicated by document, keeping the highest similarity score per document. The synthesis step is unchanged.

---

## Overall Impact

| Metric | Baseline | Query Expansion | Change |
|--------|----------|----------------|--------|
| Recall@5 | 77.0% | 78.7% | **+1.7%** |
| Precision@5 | 60.7% | 57.6% | -3.1% |
| MRR | 77.7% | 79.7% | **+2.0%** |
| Factual Containment | 77.0% | 75.0% | -2.0% |
| Citation Accuracy | 77.7% | 80.0% | **+2.3%** |
| LLM Judge | 4.0/5 | 4.0/5 | — |
| Avg Latency | 3,350ms | 5,296ms | **+1,946ms (+58%)** |

---

## Category Breakdown

| Category | Baseline R@5 | Expansion R@5 | Recall Δ | Baseline FC | Expansion FC | FC Δ | Baseline Lat | Expansion Lat | Lat Δ |
|----------|-------------|--------------|---------|------------|-------------|------|-------------|--------------|-------|
| exact_lookup | 100% | 100% | — | 100% | 100% | — | 4,079ms | 9,904ms | +143% |
| factual_extraction | 89% | 89% | — | 51% | 51% | — | 3,507ms | 5,000ms | +43% |
| tabular_statistical | 79% | 79% | — | 81% | 88% | **+7%** | 3,125ms | 5,043ms | +61% |
| paraphrase | 37% | **47%** | **+10%** | 50% | **60%** | **+10%** | 2,978ms | 5,526ms | +86% |
| cross_document | 70% | **74%** | **+4%** | 81% | 70% | -11% | 4,328ms | 5,143ms | +19% |
| negative | 100% | 100% | — | 100% | 100% | — | 1,191ms | 3,131ms | +163% |
| vague_broad | 47% | 47% | — | 100% | 80% | -20% | 3,233ms | 3,093ms | -4% |

---

## Key Findings

**What worked:**
- Paraphrase Recall improved +10% — the primary target. Synonymous queries ("revenue dashboard" finding "MRR & Subscription Dashboard") now retrieve more correct documents.
- Paraphrase FC improved +10% — better retrieval led to better answers.
- Cross-document Recall improved +4% — multi-doc queries benefit from wider semantic net.
- Citation Accuracy improved +2.3% overall.

**What didn't work:**
- vague_broad Recall unchanged at 47% — expansion generates alternative phrasings, but vague queries ("analytics and metrics", "strategy documents") need a different fix (lower threshold or higher match_count).
- factual_extraction Recall unchanged at 89% — already strong; expansion adds no value.

**Unintended costs:**
- Precision dropped -3.1% — wider retrieval net surfaces more irrelevant documents alongside relevant ones. Expected tradeoff.
- exact_lookup latency +143%, negative latency +163% — categories that don't benefit from expansion pay the highest relative cost since their baseline latency was already low.
- cross_document FC dropped -11% — more documents retrieved means a larger, noisier context for Claude synthesis; some answers lost specificity.

---

## Recommendation

Query expansion is beneficial but should be **applied conditionally**:

| Query characteristic | Action |
|---------------------|--------|
| Short, specific (≤4 words, proper nouns) | Skip expansion — exact_lookup and negative categories |
| Long or vague (≥5 words, no proper nouns) | Expand — paraphrase and cross_document categories |

A simple heuristic: skip expansion if `query.split(" ").length <= 4`. This would preserve the paraphrase gains while eliminating the latency penalty on exact_lookup (+143%) and negative (+163%) queries.

**Remaining gap:** vague_broad at 47% requires lowering the match threshold (0.5 → 0.4) or raising match_count (10 → 15), not better phrasing.
