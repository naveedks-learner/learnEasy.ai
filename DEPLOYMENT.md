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

## Staging
A separate environment (`[env.staging]` in `worker/wrangler.toml`) with its own D1, R2 and Vectorize
resources; AI and Browser are shared services. The `?tenant=` / `X-Tenant` override works in staging.

First-time setup (once):
```bash
cd worker
npx wrangler d1 create learneasy-db-staging    # paste database_id into [env.staging] in wrangler.toml
npx wrangler d1 migrations apply learneasy-db-staging --env staging --remote
npx wrangler vectorize create learneasy-chunks-staging --dimensions=768 --metric=cosine
npx wrangler vectorize create-metadata-index learneasy-chunks-staging --property-name=tenantId --type=string
npx wrangler r2 bucket create learneasy-pdfs-staging
npx wrangler secret put OPENROUTER_API_KEY --env staging
npx wrangler secret put ADMIN_API_KEY --env staging
npx wrangler secret put INGEST_API_KEY --env staging
```

Deploy:
```bash
npm run deploy:staging
```

- Staging gets its own `*.workers.dev` URL (`learneasy-worker-staging.<account>.workers.dev`).
- Secrets are per environment and must be set separately: `npx wrangler secret put KEY --env staging`.
