# Deployment

## How tenants work
Hostname -> tenant resolution lives in `worker/src/tenant.ts` (`resolveTenant`, matches `tenants.domain`).
`ADMIN_HOSTNAME` (wrangler var) serves the operator dashboard; every other host serves the student app.

## Onboard a school
1. Add the tenant in the dashboard (Tenants tab) or `POST /admin/tenants` (header `x-admin-key`).
2. The school adds a CNAME: `<their-domain>` -> `<worker-hostname>` (and the domain is added as a
   custom domain/route on the Worker).
3. The tenant shows up in the dashboard; upload PDFs and it is ready to use.

## Deploy
```bash
npm run deploy      # from repo root: builds frontend + dashboard, stages into worker/public/, wrangler deploy
```

## First-time setup (once)
```bash
cd worker
npx wrangler d1 create learneasy-db            # paste database_id into wrangler.toml
npx wrangler d1 migrations apply learneasy-db --remote
npx wrangler vectorize create learneasy-chunks --dimensions=768 --metric=cosine
npx wrangler vectorize create-metadata-index learneasy-chunks --property-name=tenantId --type=string
npx wrangler r2 bucket create learneasy-pdfs
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put INGEST_API_KEY
```
