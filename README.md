# learnEasy.ai

Multi-tenant RAG chatbot for school science/maths Q&A (16-17 year olds), built on the
Cloudflare free tier: Workers (Hono), Vectorize, Workers AI, R2, D1. One Worker serves
every school; the hostname decides which school (tenant) a request belongs to.

- `worker/` - the API plus static asset serving (`/api/chat`, `/api/explain`, `/api/ingest`, `/admin/*`).
- `frontend/` - student-facing React SPA, themed per tenant.
- `dashboard/` - operator React SPA (tenants, documents, transactions, costing, settings), served on `ADMIN_HOSTNAME`.

## Setup
```bash
cd worker && npm install && cd ../frontend && npm install && cd ../dashboard && npm install
cd worker && npx wrangler login
```
Create the D1 database, Vectorize index (with `tenantId` metadata index), R2 bucket and secrets
as described in `DEPLOYMENT.md`. Local dev: `npx wrangler dev --env dev` in `worker/`
(use `?tenant=<id>` or `X-Tenant` to pick a tenant), `npm run dev` in `frontend/` or `dashboard/`.

## Test and deploy
```bash
cd worker && npx vitest run     # tests
npm run deploy                  # from repo root: build both SPAs, stage into worker/public/, wrangler deploy
```
See `CLAUDE.md` for architecture and `DEPLOYMENT.md` for onboarding a school.
