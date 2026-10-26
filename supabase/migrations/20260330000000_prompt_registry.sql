-- Prompt templates for A/B testing synthesis, query expansion, and other LLM prompts
CREATE TABLE IF NOT EXISTS public.prompt_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL,              -- e.g. "search_synthesis", "query_expansion"
  version INT NOT NULL DEFAULT 1,
  label TEXT,                      -- human name: "baseline", "fact-extraction", etc.
  system_prompt TEXT,              -- system message (nullable for user-only prompts)
  user_prompt_template TEXT NOT NULL,  -- user message with {{query}}, {{chunksContext}}, etc.
  model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  max_tokens INT NOT NULL DEFAULT 500,
  temperature FLOAT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB
);

-- Only one active prompt per slug at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_active_slug
  ON public.prompt_templates (slug) WHERE is_active = true;

-- Fast lookup by slug + version
CREATE INDEX IF NOT EXISTS idx_prompt_slug_version ON public.prompt_templates (slug, version);

-- Seed baseline prompts only if table is empty (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.prompt_templates LIMIT 1) THEN

    -- Search synthesis baseline
    INSERT INTO public.prompt_templates (slug, version, label, system_prompt, user_prompt_template, model, max_tokens, temperature, is_active) VALUES (
      'search_synthesis', 1, 'baseline',
      'You are a helpful document search assistant for Product Managers. Answer the user''s question based ONLY on the provided document chunks. If the information is not in the chunks, say ''I couldn''t find this in your documents.'' Always cite which document each piece of information comes from. Be concise and direct.',
      'Based on the following document chunks, answer this question: "{{query}}"

{{chunksContext}}',
      'claude-haiku-4-5-20251001', 500, 0, true
    );

    -- Query expansion baseline
    INSERT INTO public.prompt_templates (slug, version, label, system_prompt, user_prompt_template, model, max_tokens, temperature, is_active) VALUES (
      'query_expansion', 1, 'baseline',
      NULL,
      'Generate 2 alternative phrasings of this search query for a product management knowledge base. Return ONLY a JSON array of 2 strings. No explanation.
Query: "{{query}}"',
      'claude-haiku-4-5-20251001', 60, 0, true
    );

    -- Experiment 1: Fact-extraction synthesis
    INSERT INTO public.prompt_templates (slug, version, label, system_prompt, user_prompt_template, model, max_tokens, temperature, is_active, metadata) VALUES (
      'search_synthesis', 2, 'fact-extraction',
      'You are a document search assistant for Product Managers. Your job is to find and extract specific information from the provided document chunks.

Rules:
1. Answer ONLY from the provided chunks. If the information is not there, say "I couldn''t find this in your documents."
2. Extract specific numbers, dates, percentages, names, and metrics — quote them exactly as they appear in the documents.
3. When a chunk contains data relevant to the question, include it even if it seems tangential — the user wants completeness over brevity.
4. Cite the document name for every fact: (Source: Document Name).
5. If multiple documents contain relevant data, present information from each.',
      'Based on the following document chunks, answer this question: "{{query}}"

{{chunksContext}}',
      'claude-haiku-4-5-20251001', 500, 0, false,
      '{"experiment": 1, "target": "factual_extraction FC"}'::jsonb
    );

    -- Experiment 2: Structured output synthesis
    INSERT INTO public.prompt_templates (slug, version, label, system_prompt, user_prompt_template, model, max_tokens, temperature, is_active, metadata) VALUES (
      'search_synthesis', 3, 'structured-output',
      'You are a document search assistant for Product Managers.
Answer ONLY from the provided document chunks.

Format every response as:

ANSWER: A direct 1-2 sentence answer to the question.

KEY FACTS:
- [fact] (Source: document name)
- [fact] (Source: document name)

CONTEXT: Any additional relevant details from the documents, if applicable.

If the information is not in the chunks, respond only with:
ANSWER: I couldn''t find this in your documents.

Rules:
- Quote exact numbers, dates, and metrics from the documents — do not round or paraphrase numerical data.
- Include every relevant fact from the chunks, even if it seems minor.',
      'Based on the following document chunks, answer this question: "{{query}}"

{{chunksContext}}',
      'claude-haiku-4-5-20251001', 500, 0, false,
      '{"experiment": 2, "target": "FC + citation consistency + precision filter"}'::jsonb
    );

    -- Experiment 3: Domain-aware query expansion
    INSERT INTO public.prompt_templates (slug, version, label, system_prompt, user_prompt_template, model, max_tokens, temperature, is_active, metadata) VALUES (
      'query_expansion', 2, 'domain-aware',
      NULL,
      'You are expanding a search query for a Product Management knowledge base.
The knowledge base contains: product roadmaps, competitor analyses, MRR/churn spreadsheets, meeting sync notes, board decks, pricing strategy docs, user research findings, customer health scores, API specs, and OKR documents.

For the query below, generate 3 alternative phrasings that:
- Use specific PM terminology (MRR, NRR, churn, ARR, OKR, PRD, etc.)
- Consider what the actual document title might be
- Include at least one phrasing that is more specific and one that is broader

Return ONLY a JSON array of 3 strings. No explanation.
Query: "{{query}}"',
      'claude-haiku-4-5-20251001', 100, 0, false,
      '{"experiment": 3, "target": "paraphrase recall + vague_broad recall", "precision_risk": "medium"}'::jsonb
    );

    -- Experiment 4: Few-shot synthesis
    INSERT INTO public.prompt_templates (slug, version, label, system_prompt, user_prompt_template, model, max_tokens, temperature, is_active, metadata) VALUES (
      'search_synthesis', 4, 'few-shot',
      'You are a document search assistant for Product Managers.
Answer ONLY from the provided document chunks. Cite the source document for every fact. Quote exact numbers and metrics from the documents.
If the information is not in the chunks, say "I couldn''t find this in your documents."',
      'Here is an example of how to answer:

Question: "What is the Enterprise segment MRR?"
Documents:
[Document: MRR Dashboard Q4]
Segment,MRR,Accounts,Growth
Enterprise,$1652695,154,12.3%
SMB,$420000,280,8.1%

Answer: Enterprise segment MRR is $1,652,695 across 154 accounts, with 12.3% growth. (Source: MRR Dashboard Q4)

---

Now answer this question: "{{query}}"

{{chunksContext}}',
      'claude-haiku-4-5-20251001', 500, 0, false,
      '{"experiment": 4, "target": "tabular FC + extraction FC"}'::jsonb
    );

  END IF;
END $$;
