# PM Compass RAG Evaluation Framework

Measures retrieval quality and answer quality for the search pipeline.

## Quick Start

### 1. Set up test documents

Create 8-10 PM documents in Google Drive (roadmaps, meeting notes, spreadsheets, etc.) and re-index from Settings.

### 2. Populate the golden dataset

Query your indexed documents to get their IDs:

```sql
SELECT DISTINCT document_id, document_title FROM document_chunks
WHERE user_id = '<your-user-id>'
ORDER BY document_title;
```

Then replace the `REPLACE_WITH_...` placeholders in `golden-dataset.json` with real document IDs.

### 3. Run the evaluation

```bash
export SUPABASE_URL="https://umxpfhudmrqcwpeuveuq.supabase.co"
export SUPABASE_ANON_KEY="<your-anon-key>"
export EVAL_USER_EMAIL="your-test-account@example.com"
export EVAL_USER_PASSWORD="your-password"
export ANTHROPIC_API_KEY="sk-ant-..."  # for LLM-as-judge

deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```

### 4. Compare runs

Change pipeline parameters, then re-run with a different `EVAL_RUN_NAME`:

```bash
EVAL_RUN_NAME="experiment-lower-threshold" deno run --allow-net --allow-read --allow-write --allow-env evals/run-evals.ts
```

Results are saved as timestamped JSON files in `evals/results/`.

## Metrics

| Metric | What it measures |
|--------|-----------------|
| **Recall@K** | Did we find the right documents in the top K? |
| **Precision@K** | How much noise in the top K results? |
| **MRR** | How high do relevant documents rank? |
| **Factual containment** | Does the answer include expected key facts? |
| **Citation accuracy** | Does the system cite the correct source documents? |
| **LLM-as-judge** | Claude rates answer quality 1-5 |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `EVAL_K` | 5 | K for Recall@K and Precision@K |
| `EVAL_SKIP_LLM_JUDGE` | false | Skip LLM-as-judge to save API cost |
| `EVAL_CONCURRENCY` | 3 | Max concurrent queries |
| `EVAL_RUN_NAME` | "baseline" | Prefix for result filenames |

## File Structure

```
evals/
  golden-dataset.json    # Test queries with ground truth
  run-evals.ts           # Evaluation harness (Deno)
  README.md              # This file
  results/               # Timestamped eval results (gitignored except .gitkeep)
    baseline-2026-03-02T10-30-00.json
    experiment-lower-threshold-2026-03-02T11-00-00.json
```
