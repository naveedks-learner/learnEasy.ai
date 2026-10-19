# learnEasy.ai — Multi-Tenant School Chatbot SaaS Design

**Date:** 2026-10-19
**Status:** Draft — awaiting approval

---

## Intent

Build a white-label RAG chatbot product sold to schools. Each school gets its own branded domain (e.g. `chat.delhipublicschool.edu.in`). A single operator (Naveed) manages every school's content, configuration, and observability from one admin dashboard with a tenant switcher. Students at each school see only their school's content and branding.

The core RAG pipeline (ingest → chunk → embed → retrieve → rerank → JEV → generate) is architecturally inspired by EdukripaLive but written from scratch — no shared code.

### Why now

EdukripaLive proved the RAG pipeline works for student Q&A. But it's single-tenant end to end — R2, Vectorize, D1, config are all global. The EdukripaLive memory explicitly says multi-tenancy should be a rebuild, not a retrofit. This is that rebuild.

### What success looks like

1. Deploy one Cloudflare Worker that serves N schools, each on its own hostname, with zero data leakage between tenants.
2. Onboarding a new school = add a tenant config entry + DNS record (no code change, no redeploy).
3. The frontend is a PWA installable on phones, wrappable to a native app (Capacitor) later without a rewrite.
4. The admin dashboard shows documents, transactions, costing, config, and observability **per tenant**, with a tenant switcher.

---

## Goals, Non-Goals, Anti-Goals

### Goals

- **Tenant isolation from day one**: every storage call namespaced by `tenantId`, derived server-side from hostname. No client input ever determines tenant identity.
- **White-label**: no learnEasy/Edukripa branding visible to students. School name, logo, theme, and domain come from tenant config.
- **Same feature set as EdukripaLive**: PDF ingestion with enrichment, chat (guardrail → retrieve → rerank → JEV → generate), concept explainer, question paper generation.
- **Operator dashboard**: single admin UI, tenant-scoped views, tenant switcher. Tabs: Documents, Transactions, Costing, Settings, Observability.
- **PWA-ready frontend**: React + Vite, installable, Capacitor-wrappable later.
- **Cheap to run**: Cloudflare free/paid tiers, OpenRouter for LLM, same cost-conscious philosophy as EdukripaLive.

### Non-Goals (not now, but designed so they're easy later)

- Cloudflare for SaaS custom hostnames automation (today: manual DNS setup per school).
- Per-school admin accounts (today: Naveed is the only admin).
- Native mobile app store listing (today: PWA only; Capacitor wrapping is a future step).
- Multi-turn agentic chat (same fixed pipeline as EdukripaLive).
- Student authentication / login (chat is open to anyone on the school's domain).

### Anti-Goals (would make this a failure)

- Cross-tenant data leakage: a student at School A seeing School B's content.
- Hardcoded school names, logos, or domains anywhere in code.
- Absolute URLs with a shared domain (everything is relative or derived from request origin).
- An architecture that requires a code change or redeploy to add a new school.

---

## Constraints

- **Cloudflare-native**: Workers, Vectorize, R2, D1, Workers AI. No external databases or servers.
- **Single codebase, single Worker deployment** serving all tenants (API + static frontend assets).
- **No code shared with EdukripaLive** — architectural inspiration only.
- **Budget-conscious**: free tiers where possible, OpenRouter for LLM generation.
- **Target audience is minors** (school students) — guardrail must fail closed, same as EdukripaLive.

---

## Architecture

### Hosting Model — Worker Serves Everything

Unlike EdukripaLive (separate Worker + Pages deployments), learnEasy.ai uses a **single Worker that serves both API routes and static frontend assets**. This is the cleanest multi-tenant model:

- Every school's domain (CNAME) points to the same Worker.
- The Worker resolves the tenant from the hostname on every request.
- API routes (`/api/*`, `/admin/*`) are handled directly.
- All other routes serve the static SPA (React build output stored in R2 or KV as a site asset bundle).
- The PWA manifest (`/manifest.json`) is dynamically generated per tenant (school name, colors, icons).
- The dashboard is the same Worker on a designated admin hostname (e.g. `admin.learneasy.ai`), serving a separate SPA build.

This means **one deployment target** (the Worker), not two. Adding a school = DNS + tenant config row, no additional Pages project.

### Tenant Resolution

```typescript
// The ONE function that maps hostname → tenant. Nothing else reads the hostname.
async function resolveTenant(request: Request, env: Env): Promise<TenantConfig>

interface TenantConfig {
  tenantId: string;          // e.g. "dps-rk-puram" — the namespace key everywhere
  name: string;              // "Delhi Public School, R.K. Puram"
  logoUrl: string;           // served from R2 or external
  theme: {
    primaryColor: string;
    accentColor: string;
    fontFamily?: string;
  };
  allowedOrigins: string[];  // for CORS — derived from the school's domain
  domain: string;            // "chat.delhipublicschool.edu.in"

  // Feature flags (override global defaults per school)
  features: {
    conceptExplainerEnabled: boolean;
    questionPaperEnabled: boolean;
    webSearchEnabled: boolean;
  };

  // Per-tenant rate limits
  rateLimits: {
    chatRequestsPerMinute: number;
    ingestMaxFileSizeMb: number;
  };
}
```

**Phase 1 implementation**: tenant configs stored in a D1 `tenants` table. Looked up by hostname via `resolveTenant`. Cached using the **Workers Cache API** (not in-memory — Worker isolates are ephemeral and can recycle in seconds, so in-memory caches are unreliable). Cache key: `tenant:<hostname>`, TTL: 5 minutes. Cache miss → D1 query. A hardcoded "default" tenant for local dev.

**Dev override**: when `env.ENVIRONMENT === "development"`, allow `?tenant=<id>` or `X-Tenant: <id>` header to override hostname resolution. Stripped in production.

### Storage Namespacing

Every storage path includes `tenantId` as a prefix/namespace, derived server-side:

| Storage | EdukripaLive (single-tenant) | learnEasy.ai (multi-tenant) |
|---------|------------------------------|------------------------------|
| R2 PDFs | `<filename>` | `t/<tenantId>/docs/<filename>` |
| R2 page images | `page-images/<filename>/<page>.png` | `t/<tenantId>/images/<filename>/<page>.png` |
| R2 enriched text | `cleaned/<filename>.md` | `t/<tenantId>/cleaned/<filename>.md` |
| R2 tenant assets | n/a | `t/<tenantId>/assets/logo.png` etc. |
| Vectorize IDs | `hash(filename)::chunkN` | `hash(tenantId + filename)::chunkN` |
| Vectorize metadata | `{ filename, page, ... }` | `{ tenantId, filename, page, ... }` |
| Vectorize query | `query(embedding, { topK })` | `query(embedding, { topK, filter: { tenantId } })` |
| D1 config | global key/value | `WHERE tenant_id = ?` |
| D1 transactions | no tenant column | `WHERE tenant_id = ?` |

**Critical — Vectorize metadata filtering**: `tenantId` MUST be declared as an indexed metadata field when creating the Vectorize index (`--metadata-indexes tenantId:string`). Cloudflare Vectorize only filters on pre-declared indexed fields. Changing this later requires recreating the index. This is the data isolation boundary for retrieval — every `VECTORIZE.query()` call MUST include the tenant filter. This is the #1 thing to get right and test explicitly.

### Folder Structure

```
learnEasy.ai/
├── worker/
│   ├── src/
│   │   ├── index.ts              # Entry point, routing, static asset serving
│   │   ├── tenant.ts             # resolveTenant(), TenantConfig type, dev override
│   │   ├── env.ts                # Env interface (bindings + secrets)
│   │   ├── config.ts             # Per-tenant runtime config (D1-backed)
│   │   ├── cors.ts               # Tenant-aware CORS (allowedOrigins from TenantConfig)
│   │   ├── staticAssets.ts       # Serves frontend SPA + dashboard from KV/R2
│   │   │
│   │   ├── ingestion.ts          # POST /ingest — tenant-scoped
│   │   ├── pdf.ts                # PDF text extraction (unpdf)
│   │   ├── ingestionEnrichment.ts # OpenRouter PDF→Markdown enrichment
│   │   ├── pageScreenshot.ts     # Cloudflare Browser Rendering screenshots
│   │   ├── chunker.ts            # Text chunking
│   │   ├── vectorId.ts           # Tenant-scoped deterministic vector IDs
│   │   │
│   │   ├── chat.ts               # POST /chat — tenant-scoped retrieval + generation
│   │   ├── explain.ts            # POST /explain — concept explainer
│   │   ├── questionPaper/        # Question paper generation (sub-folder)
│   │   │   ├── generation.ts
│   │   │   ├── blueprints.ts
│   │   │   ├── answerKey.ts
│   │   │   ├── pdf.ts
│   │   │   └── cache.ts
│   │   │
│   │   ├── guardrail.ts          # Keyword + embedding guardrail (fails closed)
│   │   ├── rerank.ts             # Cross-encoder reranking
│   │   ├── jev.ts                # JEV relevance + injection check
│   │   ├── llm.ts                # LLM generation (OpenRouter / Workers AI)
│   │   ├── webSearch.ts          # DuckDuckGo fallback
│   │   │
│   │   ├── admin.ts              # /admin/* — tenant-scoped, tenant switcher
│   │   ├── transactionTrace.ts   # Audit logging (tenant-scoped)
│   │   └── storage.ts            # Tenant-scoped R2/Vectorize/D1 helpers
│   │
│   ├── test/                     # Vitest — mirrors src/ 1:1
│   ├── migrations/               # D1 migrations
│   ├── evals/                    # Manual eval harness
│   ├── wrangler.toml
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── package.json
│
├── frontend/                     # React + Vite PWA (student-facing)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api/                  # API client (relative URLs only — same origin)
│   │   ├── components/
│   │   │   ├── Chat/
│   │   │   ├── ConceptExplainer/
│   │   │   └── common/
│   │   ├── hooks/
│   │   ├── theme/                # Dynamic theming from /api/tenant response
│   │   └── pwa/                  # Service worker registration
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── dashboard/                    # Operator dashboard (separate React app)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── TenantSwitcher/
│   │   │   ├── Documents/
│   │   │   ├── Transactions/
│   │   │   ├── Costing/
│   │   │   ├── Settings/
│   │   │   └── Observability/
│   │   └── api/
│   ├── vite.config.ts
│   └── package.json
│
├── docs/
│   └── superpowers/
├── CLAUDE.md
├── DEPLOYMENT.md                 # <30 lines: tenant resolution, onboarding steps
└── README.md
```

**How the build/deploy works**: `frontend/` and `dashboard/` are built with Vite → static files. A deploy script uploads the built assets to Workers KV (using Wrangler's `--assets` or a KV site binding). The Worker serves these assets for non-API routes, choosing which SPA based on whether the hostname is the admin domain or a school domain.

**Key differences from EdukripaLive:**
- **Single deployment target** — the Worker serves API + static assets (no separate Pages deploy).
- `frontend/` is React + Vite (not plain HTML) — PWA-ready, Capacitor-wrappable.
- `dashboard/` is a separate SPA build (not co-deployed with the student frontend as separate HTML files) — served on the operator domain only.
- `worker/src/storage.ts` is new — centralizes all tenant-namespaced storage calls so no individual handler forgets the prefix.
- `worker/src/tenant.ts` is the single point of tenant resolution.
- `worker/src/staticAssets.ts` is new — serves the right SPA (student vs dashboard) based on hostname.

### D1 Schema

```sql
-- Tenants table (the source of truth for tenant config)
CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  theme_json TEXT,           -- JSON: { primaryColor, accentColor, fontFamily }
  allowed_origins_json TEXT, -- JSON array
  features_json TEXT,        -- JSON: feature flag overrides
  rate_limits_json TEXT,     -- JSON: { chatRequestsPerMinute, ingestMaxFileSizeMb }
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Per-tenant config (same as EdukripaLive but scoped)
CREATE TABLE config (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

-- Transactions (audit log, tenant-scoped)
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  path_taken TEXT,
  question TEXT,
  answer TEXT,
  model TEXT,
  provider TEXT,
  trace_json TEXT,
  token_estimate INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

-- Question paper cache (tenant-scoped)
CREATE TABLE question_paper_cache (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
```

### Request Flow (How Tenancy Threads Through)

Every request follows this shape:

```
Request
  → resolveTenant(request, env) → TenantConfig
  → is it an API route?
      YES → route handler receives (request, env, tenant, ctx)
            → all storage calls use tenant.tenantId
            → CORS derived from tenant.allowedOrigins
            → JSON response
      NO  → is hostname the admin domain?
            YES → serve dashboard SPA
            NO  → serve student frontend SPA
```

The `tenant` object is resolved once at the top of `index.ts` and passed down. No handler resolves it independently. No handler reads `request.url` for hostname.

### Frontend — Tenant-Aware Theming

The student frontend fetches tenant config on load via `GET /api/tenant` (returns name, logo, theme — no secrets). This drives:
- Page title, logo, favicon
- CSS custom properties for colors
- PWA manifest (`GET /manifest.json` — dynamically generated by the Worker per tenant)

No school name or branding is baked into the frontend build. The same build artifact serves every school — only the API responses differ.

### Admin Dashboard — Tenant Switcher

The dashboard is served on the admin hostname (e.g. `admin.learneasy.ai`). It authenticates Naveed via `x-admin-key` (same as EdukripaLive for now). A tenant switcher dropdown at the top lets you select which school you're viewing. Every dashboard API call includes the selected `tenantId` as a query param, and the worker scopes its response accordingly.

**Note on admin auth**: The `x-admin-key` protects all `/admin/*` routes. The `tenantId` param is a view filter, not an auth boundary — Naveed is the sole admin and can see all tenants. If per-school admin accounts are added later, the `tenantId` would become an auth-scoped value derived from the admin's session, not a client-supplied param.

New admin routes:
- `GET /admin/tenants` — list all tenants
- `POST /admin/tenants` — create a new tenant
- `PUT /admin/tenants/:id` — update tenant config
- `DELETE /admin/tenants/:id` — remove a tenant
- `GET /admin/tenants/:id/stats` — quick stats (doc count, query count, last activity)

### Tenant Onboarding UI (Dashboard)

The dashboard includes a dedicated **Onboard New School** screen — not just backend scripts. Flow:

1. **Form**: school name, tenantId slug (auto-generated from name, editable), domain, logo upload, theme colors (color pickers), feature flags (toggles with sensible defaults).
2. **Validation**: checks tenantId uniqueness, domain uniqueness, slug format.
3. **Submit** → `POST /admin/tenants` → creates D1 row + R2 asset prefix.
4. **Post-creation card**: shows the DNS instructions the school needs to follow (CNAME record pointing to the Worker domain, plus a TXT verification record if needed). Copy-to-clipboard for easy sharing.
5. The new tenant appears immediately in the tenant switcher dropdown.

The existing tenant list view shows all onboarded schools as cards with name, domain, status (active/DNS pending), doc count, and last activity. Clicking one opens the tenant switcher to that school.

Existing EdukripaLive admin routes (`/admin/documents`, `/admin/transactions`, `/admin/costing`, `/admin/config`) all gain a required `tenant_id` parameter.

### Rate Limiting

`rateLimits` in `TenantConfig` defines per-tenant limits. Phase 1 implementation: a simple sliding-window counter in D1 (one row per tenant per minute, checked on `/chat` and `/explain`). Not high-performance, but fine for the expected load (tens of students per school, not thousands). If scale demands it later, migrate to Durable Objects or the Workers Rate Limiting API with tenant-scoped keys.

### Failure Philosophy

Same as EdukripaLive — carried forward exactly:
- **Guardrail fails closed** (audience is minors)
- **LLM generation throws** (cost/quality regression must be visible)
- Everything else **fails open** (reranker → cosine order, JEV → unfiltered, web search → empty, enrichment → plain text, screenshots → no image)

### CORS

Tenant-aware. `cors.ts` reads `tenant.allowedOrigins` instead of a static list. Since the Worker serves the frontend on the same origin, CORS is mainly needed for the dashboard (different hostname) calling tenant-scoped admin APIs. The dev tenant allows `*`.

### Secrets & API Keys

Global secrets in `env` (same as EdukripaLive): `OPENROUTER_API_KEY`, `ADMIN_API_KEY`, `INGEST_API_KEY`. Per-tenant overrides (e.g. a school that brings their own OpenRouter key) can live in the `tenants` table later — not needed for phase 1 since Naveed manages all keys centrally.

### Health Check

`GET /health` — unauthenticated, returns `{ ok: true, tenantCount: N }`. Does not require tenant resolution (runs before it). Used to verify the Worker is deployed and D1 is reachable.

---

## Phase 1 Scope (What Gets Built Now)

1. **Worker skeleton**: `index.ts` routing + static asset serving, `tenant.ts` resolution (Cache API-backed), `env.ts`, `cors.ts`, `storage.ts` tenant-scoped helpers, `staticAssets.ts`.
2. **D1 schema + migrations**: `tenants`, `config`, `transactions`, `question_paper_cache` tables.
3. **Vectorize index creation**: with `tenantId` declared as an indexed metadata field.
4. **Ingestion pipeline**: `POST /ingest` — PDF extraction, enrichment, chunking, tenant-scoped embedding + R2 storage. Port logic from EdukripaLive, rewrite with tenant namespacing.
5. **Chat pipeline**: `POST /chat` — guardrail, retrieve (tenant-filtered Vectorize query), rerank, JEV, generate, transaction trace.
6. **Concept explainer**: `POST /explain` — same as EdukripaLive but tenant-scoped.
7. **Admin API**: tenant CRUD, plus tenant-scoped versions of documents/transactions/costing/config.
8. **`GET /api/tenant`**: public endpoint returning tenant branding for the frontend.
9. **`GET /manifest.json`**: dynamically generated PWA manifest per tenant.
10. **`GET /health`**: deployment verification endpoint.
11. **Rate limiting**: D1-based sliding window counter per tenant on `/chat` and `/explain`.
12. **Test suite**: Vitest with mocked bindings, explicit tenant isolation tests (query with tenant A's ID must not return tenant B's chunks).
13. **Frontend (React + Vite)**: Chat UI, concept explainer, tenant-aware theming, PWA manifest. No question papers in phase 1 frontend (API can exist, UI later).
14. **Dashboard (React + Vite)**: Tenant switcher, Documents tab, Transactions tab, Settings tab. Costing and Observability tabs can be stubs.
15. **DEPLOYMENT.md**: Where tenant resolution lives, steps to onboard a school (<30 lines).

### Deferred

- Question paper frontend UI (API ready, UI later)
- Cloudflare for SaaS custom hostname automation
- Per-school admin accounts
- Capacitor native app wrapping
- CI/CD pipeline
- Real observability (structured logging, alerting)
- Student auth / login

---

## Technology Decisions (Locked In)

- **Routing**: Hono — Cloudflare-recommended, ~14KB, type-safe middleware chain. The flat if-chain pattern from EdukripaLive doesn't scale to this many routes + middleware (tenant resolution, CORS, auth, rate limiting all need to compose cleanly).
- **Styling**: Tailwind CSS, no component library. Keeps the bundle small, no React UI library lock-in. Tenant theming via CSS custom properties works naturally with Tailwind's arbitrary value support.
- **PWA caching**: Network-first for API calls (students must get fresh answers), cache-first for static assets (rarely change).
- **No LangGraph / no Python**: The fixed RAG pipeline (not agentic) runs entirely in TypeScript on Cloudflare Workers. Predictability and cost control matter more than agentic flexibility for a school product. Multi-turn agentic chat is a deferred non-goal.

### Left to the Builder

- Exact Vitest mock patterns for tenant-scoped D1 queries (implementation detail, not architectural)

---

## Setup Commands (First-Time)

```bash
cd worker
npm install
npx wrangler d1 create learneasy-db
npx wrangler r2 bucket create learneasy-pdfs
npx wrangler vectorize create learneasy-chunks \
  --dimensions=768 --metric=cosine \
  --metadata-indexes "tenantId:string"
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put INGEST_API_KEY
```
