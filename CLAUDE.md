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

Deploy (from repo root): `npm run deploy` -> `scripts/build-and-deploy.sh` builds both SPAs, copies `frontend/dist` to `worker/public/` and `dashboard/dist` to `worker/public/dashboard/`, then `wrangler deploy`. `worker/public/` is a gitignored build artifact. There is no CI/CD. First-time infra setup and school onboarding: `DEPLOYMENT.md`.

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

Gated by `x-ingest-key`. Pipeline: dedup check -> `extractPdfPages()` (`pdf.ts`, unpdf; copies the buffer because PDF.js detaches it) -> optional OpenRouter Markdown enrichment (`ingestionEnrichment.ts`, page-labelled, per-page fallback to plain text) -> screenshots for `[Figure:` pages via Browser Rendering -> `chunkText()` (300 words, 50 overlap) -> embed (`@cf/baai/bge-base-en-v1.5`) -> `VECTORIZE.upsert()` -> only then write R2 (source PDF + cleaned text), so failed ingests leave nothing behind. Max file size is per tenant (`rateLimits.ingestMaxFileSizeMb`).

### Chat (`chat.ts`) and Concept Explainer (`explain.ts`)

Per-tenant `RuntimeConfig` is read fresh from D1 each call (`config.ts`: `topK`, thresholds, `webSearchMode`, JEV, guardrail, `llmProvider`/`llmModelSlug`, enrichment, `explainRetrievalMode`, `answerStyle`, ...). Chat: guardrail (fails closed) -> embed -> tenant-filtered Vectorize query -> rerank (falls back to cosine) -> JEV (`jev.ts`, fails open) -> confidence gate -> web fallback (`webSearch.ts`, never throws) -> `generateChatCompletion()` (`llm.ts`; throws on failure, deliberately no silent fallback). A transaction row is written via `ctx.waitUntil()`. `/api/explain` is the same retrieval shape returning structured JSON, tolerant parser that never throws, gated by the tenant feature flag `conceptExplainerEnabled`.

### Admin (`admin.ts`)

All routes need `x-admin-key` and `ADMIN_HOSTNAME`: tenant CRUD (`/admin/tenants`, `/:id`, `/:id/stats`), `/admin/documents` (+ `/cleaned`), `/admin/transactions`, `/admin/costing`, `GET/PUT /admin/config`.

### Failure philosophy

Most stages fail open (reranker, JEV, web search, enrichment, screenshots). Deliberate exceptions: guardrail fails closed; LLM generation throws. Tests should assert these contracts explicitly.

## Testing conventions

Vitest with mocked bindings; `worker/test/*.test.ts` mirrors `worker/src/*.ts`. Vectorize, Workers AI and Browser Rendering cannot be emulated locally - verify those after deploy with `wrangler tail`.
