# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

learnEasy.ai: a multi-tenant, Cloudflare-native RAG chatbot for science/maths Q&A, aimed at 16-17 year old students. Many schools (tenants) share one deployment; each has its own domain, branding, feature flags, documents, config and transaction log. Free-tier stack: Workers (Hono), Vectorize, Workers AI, R2, D1, Browser Rendering. Three pieces in one repo:

- `worker/` - the single Cloudflare Worker (`learneasy-worker`): all API routes plus static asset serving for both SPAs.
- `frontend/` - student-facing React + Vite SPA (chat, concept explainer). Themed from `/api/tenant`. No upload UI.
- `dashboard/` - operator-only React + Vite + Tailwind SPA (tenants, documents/ingestion, transactions, costing, settings). Built with `base: "/dashboard/"`.

Older design docs live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## Commands

Worker commands run from `worker/`:

```bash
npm install
npx vitest run                              # full suite (@cloudflare/vitest-pool-workers)
npx vitest run test/chat.test.ts -t "name"  # single file / test
npx tsc --noEmit                            # type-check
npx wrangler dev --env dev                  # local dev; enables ?tenant= / X-Tenant override
npx wrangler tail --format pretty           # live production logs
npx wrangler secret put OPENROUTER_API_KEY  # also ADMIN_API_KEY, INGEST_API_KEY
```

SPAs: `npm run dev` / `npm run build` inside `frontend/` or `dashboard/` (dev servers proxy `/api` and `/admin` to the worker on :8787).

Deploy (from repo root): `npm run deploy` (production) or `npm run deploy -- --staging` (staging). `scripts/build-and-deploy.sh` builds both SPAs, copies `frontend/dist` to `worker/public/` and `dashboard/dist` to `worker/public/dashboard/`, then `wrangler deploy`. `worker/public/` is a gitignored build artifact. There is no CI/CD. Always deploy to staging first and verify before production. First-time infra setup and school onboarding: `DEPLOYMENT.md`.

D1 migrations: `npx wrangler d1 migrations apply <db-name> --remote` (run from `worker/`). Apply to both staging (`learneasy-db-staging`) and production (`learneasy-db`) when adding schema changes.

## Architecture

### Request flow (`worker/src/index.ts`)

Hono app, middleware order matters:

1. `GET /health`, then `/admin/*` (`admin.ts`, own auth/CORS - mounted before tenant resolution).
2. Admin-host static: GET/HEAD on `ADMIN_HOSTNAME` that is not `/api/`, `/admin`, `/health` serves the dashboard SPA *before* tenant resolution (the admin host has no tenant row).
3. Tenant resolution (`tenant.ts` `resolveTenant`): hostname -> `tenants.domain` row -> `TenantConfig` in `c.var.tenant`. Unknown host -> 404 "Unknown school". `X-Tenant` header / `?tenant=` override is honoured only when `ENVIRONMENT=development` or a valid `x-admin-key` is sent (the dashboard uses this to ingest on a tenant's behalf).
4. CORS (`cors.ts`, per-tenant `allowedOrigins`).
5. Routes: `GET /api/tenant`, `GET /manifest.json` (per-tenant PWA manifest), `GET /api/images/*`, `POST /api/ingest`, `/api/chat`, `/api/explain`.
6. Last route `GET *` -> `serveStaticAsset` (`staticAssets.ts`): student SPA, or dashboard SPA on the admin host; extensionless unknown paths fall back to `index.html`; hashed `/assets/*` get immutable caching, `index.html` is `no-cache`.

`wrangler.toml` `[assets]` (directory `public`, binding `ASSETS`, `run_worker_first = true`) is required so the worker, not Cloudflare, chooses which SPA a host gets. `Env` is in `env.ts`.

### Tenant isolation

Every tenant-scoped resource goes through `TenantStorage` (`storage.ts`): R2 keys are `t/<tenantId>/<prefix>/...` (prefixes include source PDFs, `images`, `cleaned`), vector IDs are tenant-scoped, vector metadata carries `tenantId`, and `vectorFilter()` is applied on every Vectorize query (requires a `tenantId` metadata index on the index). D1 tables (`migrations/0001_initial.sql`): `tenants`, `config` (per-tenant), `transactions`, `question_paper_cache`, `rate_limits`. Per-tenant chat rate limiting in `rateLimit.ts`.

### Ingestion (`POST /api/ingest`, `ingestion.ts`)

Gated by `x-ingest-key`. Pipeline: dedup check -> `extractPdfPages()` (`pdf.ts`, unpdf; copies the buffer because PDF.js detaches it) -> optional OpenRouter Markdown enrichment (`ingestionEnrichment.ts`, page-labelled, per-page fallback to plain text) -> screenshots for `[Figure:` pages via Browser Rendering -> chunking -> embed (`@cf/baai/bge-base-en-v1.5`) -> `VECTORIZE.upsert()` -> only then write R2 (source PDF + cleaned text), so failed ingests leave nothing behind. Max file size is per tenant (`rateLimits.ingestMaxFileSizeMb`).

**Chunking** (`chunker.ts`): two modes controlled by `config.chunkingMode`:
- `"semantic"` (default): structure-aware — splits at Markdown headings, keeps equations/proofs/worked examples/tables as atomic blocks, then applies percentile-based semantic chunking within each section (embed segments, split at bottom N% similarity gaps; N = `config.semanticPercentile`, default 93). Stores `section` and `contentType` metadata on vectors.
- `"fixed"`: original 300-word / 50-overlap sliding window with table protection.

### Chat (`chat.ts`) and Concept Explainer (`explain.ts`)

Per-tenant `RuntimeConfig` is read fresh from D1 each call (`config.ts`: `topK`, thresholds, `webSearchMode`, JEV, guardrail, `llmProvider`/`llmModelSlug`, enrichment, `explainRetrievalMode`, `answerStyle`, `chunkingMode`, `semanticPercentile`, ...). Chat: guardrail (fails closed) -> embed -> tenant-filtered Vectorize query -> rerank (falls back to cosine) -> JEV (`jev.ts`, fails open) -> confidence gate -> web fallback (`webSearch.ts`, never throws) -> `generateChatCompletion()` (`llm.ts`; throws on failure, deliberately no silent fallback). A transaction row is written via `ctx.waitUntil()`. `/api/explain` is the same retrieval shape returning structured JSON, tolerant parser that never throws, gated by the tenant feature flag `conceptExplainerEnabled`.

**LLM-selected figures**: Chat responses may include a `SHOW_FIGURES: file.pdf:3, file.pdf:7` line parsed by `parseShowFigures()` in `chat.ts`. Only relevant diagrams are sent to the frontend as `relevantFigures`.

**Math-aware prompts**: `MATH_RE` detects math questions; chat and explainer use structured prompts (Given → Step-by-Step Calculation → final answer) with display math (`$$...$$`).

**Token tracking**: `llm.ts` captures `inputTokens`/`outputTokens` from OpenRouter responses. Stored in D1 (`migrations/0002_token_breakdown.sql`). Costing tab shows per-model input/output breakdown with actual rates.

**Models** (defaults, configurable per tenant via Settings):
- Chat/Explain LLM: `google/gemini-2.5-flash` (via OpenRouter)
- Embedding: `@cf/baai/bge-base-en-v1.5` (Workers AI, free)
- Reranker: `@cf/baai/bge-reranker-base` (Workers AI, free)
- Evals judge: `openai/gpt-4o-mini` (via OpenRouter)
- Enrichment: `google/gemini-2.5-flash` (via OpenRouter)

### Admin (`admin.ts`)

All routes need `x-admin-key` and `ADMIN_HOSTNAME`: tenant CRUD (`/admin/tenants`, `/:id`, `/:id/stats`), `/admin/documents` (+ `/cleaned`, `/chunks`, reingest, retry-screenshots), `/admin/transactions`, `/admin/costing` (per-model breakdown with input/output tokens), `GET/PUT /admin/config`.

### Dashboard tabs

- **Tenants**: CRUD, stats, onboarding.
- **Documents**: list, view cleaned text, view chunks, reingest, retry screenshots.
- **Transactions**: query log with pipeline detail (chunks, rerank/JEV scores, model I/O). Path labels: Chat, Out of Syllabus, Concept Explainer, Web Fallback.
- **Costing**: per-model cost breakdown using actual input/output token rates. Pricing reference card.
- **Observability**: pipeline path distribution, model usage, RAG success rate.
- **Settings**: runtime config editor (all `RuntimeConfig` fields), Models & Infrastructure card.

### Failure philosophy

Most stages fail open (reranker, JEV, web search, enrichment, screenshots). Deliberate exceptions: guardrail fails closed; LLM generation throws. Tests should assert these contracts explicitly.

## Testing conventions

Vitest with mocked bindings; `worker/test/*.test.ts` mirrors `worker/src/*.ts`. Vectorize, Workers AI and Browser Rendering cannot be emulated locally - verify those after deploy with `wrangler tail`.

## Evals

`evals/run-evals.ts` runs golden-case evaluations against a live deployment. Uses `evals/golden-cases.json` (question + expected answer pairs). Judge model: `openai/gpt-4o-mini`. Config in `evals/eval-config.json`.

## Key docs

- `docs/QualityAnswering.md` — quality improvement recommendations, system prompt proposals, cost estimates vs NotebookLM.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — original design docs.
