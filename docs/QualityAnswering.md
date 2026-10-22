# Quality Answering — Closing the Gap with NotebookLM

## Context

NotebookLM (now Gemini Notebook) runs on Gemini 3.5, ingests full documents into a long context window, and lets the model reason freely over source material. Our stack uses GPT-4o-mini with strict grounding, 300-word fixed chunks, and tight token limits. The quality gap is real and compounds across these layers.

## Changes (Priority Order)

### 1. Input/Output Token Tracking

**Status:** To implement

Currently we store a single `tokenEstimate` (character-based heuristic). OpenRouter returns `usage.prompt_tokens` and `usage.completion_tokens` — we should capture and display both.

- **llm.ts**: Parse `prompt_tokens` and `completion_tokens` from OpenRouter response
- **transactionTrace.ts**: Store `inputTokens` and `outputTokens` separately
- **D1 schema**: Add columns or store in the existing trace JSON
- **Dashboard**: Transactions, Costing tabs show input/output breakdown
- **Why**: Cost tracking, prompt bloat detection, answer truncation diagnosis

### 2. Model Swap

**Status:** Config change — done

| Role | Before | After |
|------|--------|-------|
| Chat/Explain LLM | `openai/gpt-4o-mini` | `google/gemini-2.5-flash` |
| Evals Judge | `google/gemini-2.5-flash` | `openai/gpt-4o-mini` |

Gemini 2.5 Flash is ~3x costlier than GPT-4o-mini but dramatically better at:
- Multi-step math reasoning and proofs
- Following structured output instructions (fewer JSON parse failures)
- Producing natural, well-organized explanations
- LaTeX formatting

The eval judge doesn't need frontier quality — it checks factual coverage against keyFacts. GPT-4o-mini is sufficient and cheaper for that role.

### 3. Semantic Chunking

**Status:** To implement

Current: fixed 300-word windows with 50-word overlap. Problems:
- Splits theorems from their proofs
- Splits worked examples from the formulas they demonstrate
- Splits diagram descriptions from explanations

**New approach:**
- Use heading/section detection to find natural boundaries in enriched markdown
- Each section becomes one chunk (with a max size cap to avoid oversized chunks)
- Fallback to word-based splitting only for sections that exceed the cap
- Increase topK from 5 to 8 to retrieve more context, let reranker filter
- Requires re-ingestion of all PDFs after implementation

### 4. Relaxed System Prompt (Grounding)

**Status:** Done

**Current (chat):**
> "Answer using ONLY the provided context. Quote or closely paraphrase it. Never add facts, figures, formulas or definitions that are not in the context, even ones you know to be true."

**Proposed:**
> "Ground your answer in the provided context — use its facts, formulas, and definitions as your foundation. You may apply mathematical reasoning, rearrange equations, draw logical conclusions, and explain implications that follow from the context. Do NOT introduce facts, formulas, or claims that aren't supported by or derivable from the context. If the context is insufficient, say so."

**Why:** The current rule prevents the model from *teaching*. A textbook states Pythagoras' theorem; our current prompt prevents the model from rearranging `a² + b² = c²` to solve for a side because that rearrangement isn't literally in the text. The proposed version allows reasoning while maintaining source grounding.

**Current (explainer, strict mode):**
> "Use ONLY the provided context for facts, formulas and definitions. Never add facts that are not in the context, even ones you know to be true."

**Proposed:**
> "Use the provided context as your primary source for facts, formulas and definitions. You may reason over, rearrange, and derive from what the context provides. Do not introduce facts or formulas that aren't in or derivable from the context. If the context is insufficient, say so in the simpleExplanation field."

### 5. Token Limit Increases

**Status:** Done

| Endpoint | Style | Before | After |
|----------|-------|--------|-------|
| Chat | auto | 512 | 1024 |
| Chat | short | 100 | 200 |
| Chat | detailed | 500 | 1200 |
| Chat (math) | auto | 800 | 1500 |
| Chat (math) | short | 300 | 400 |
| Chat (math) | detailed | 800 | 1500 |
| Explainer | default | 1800 | 2400 |
| Explainer | math | 2400 | 3000 |

### 6. Simplify Explainer Output (Future)

**Status:** Deferred

Consider letting the explainer return markdown instead of rigid JSON. The JSON structure forces the model to waste tokens on syntax and constrains the explanation format. A markdown response with a lightweight metadata extraction pass would produce more natural explanations. To be evaluated after items 1-5 are stable.

---

## Expected Impact

With changes 1-5 implemented:
- **Model swap** alone closes ~60% of the quality gap
- **Relaxed grounding** lets the model teach, not just quote
- **Higher token limits** prevent truncated answers
- **Semantic chunking** keeps related content together in retrieval
- **Token tracking** gives visibility into costs and prompt efficiency

## Cost Estimate

Gemini 2.5 Flash pricing (via OpenRouter):
- Input: ~$0.15/1M tokens
- Output: ~$0.60/1M tokens

For a school with ~200 questions/day, average 2K input + 500 output tokens per question:
- Daily cost: ~$0.12
- Monthly cost: ~$3.60

This is well within educational budget constraints.
