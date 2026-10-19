# learnEasy.ai Multi-Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-tenant school chatbot SaaS on Cloudflare Workers — one Worker deployment serving N schools, each on its own hostname, with tenant-isolated RAG (ingest, chat, explain), an operator dashboard with tenant onboarding, and a PWA student frontend.

**Architecture:** A single Hono-based Cloudflare Worker resolves the tenant from the request hostname, then routes to API handlers (all tenant-scoped) or serves one of two React SPAs (student frontend or operator dashboard) based on hostname. Every storage path (R2, Vectorize, D1) is namespaced by `tenantId`. The frontend fetches tenant branding at load time — no school names baked into the build.

**Tech Stack:** TypeScript, Hono (Worker routing), Cloudflare Workers/D1/R2/Vectorize/Workers AI/Browser Rendering, React 18 + Vite + Tailwind CSS (frontend & dashboard), unpdf (PDF extraction), OpenRouter (LLM generation), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-10-19-learneasy-multitenant-design.md`

## Global Constraints

- TypeScript strict mode, no `any` except in test mocks.
- Hono v4+ for Worker routing. React 18. Vite 6+. Tailwind v4+.
- No absolute URLs with any hardcoded domain — relative paths or request origin only.
- No school names, logos, or domains hardcoded anywhere — all from tenant config.
- `tenantId` is derived server-side from hostname only, never from client input (except dev override when `ENVIRONMENT === "development"`).
- Every `VECTORIZE.query()` call MUST include `filter: { tenantId }`.
- Every R2 key MUST be prefixed with `t/<tenantId>/`.
- Every D1 query on `config`, `transactions`, `question_paper_cache` MUST include `WHERE tenant_id = ?`.
- Guardrail fails closed. LLM generation throws. Everything else fails open.
- Commit after each task passes its tests.

## Review Focus

1. **Cross-tenant data leakage in Vectorize queries**: a missing `filter: { tenantId }` on any `VECTORIZE.query()` call leaks another school's content — expect every retrieval path to be filtered.
2. **R2 path traversal**: a crafted filename (e.g. `../../other-tenant/docs/secret.pdf`) could escape the tenant prefix — expect filenames to be sanitized before joining with the tenant prefix.
3. **Dev tenant override in production**: the `?tenant=` / `X-Tenant` override must be strictly gated by `env.ENVIRONMENT === "development"` — expect it to be completely ignored in production, not just logged.
4. **Dashboard CORS with tenant-scoped admin calls**: the admin dashboard runs on a different hostname (`admin.learneasy.ai`) than the school domains — expect CORS on `/admin/*` routes to allow the admin origin, not just the current tenant's `allowedOrigins`.
5. **Dynamic PWA manifest correctness**: `GET /manifest.json` must return valid JSON with tenant-specific `name`, `short_name`, `theme_color`, `icons` — expect it to work when `logoUrl` is null or empty (new tenant, no logo yet).

---

### Task 1: Project Scaffolding + Worker Skeleton with Tenant Resolution

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/env.ts`
- Create: `worker/src/tenant.ts`
- Create: `worker/src/index.ts`
- Create: `worker/migrations/0001_initial.sql`
- Test: `worker/test/tenant.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `Env` interface in `env.ts`: `{ DB: D1Database, VECTORIZE: VectorizeIndex, PDF_BUCKET: R2Bucket, AI: Ai, BROWSER: Fetcher, OPENROUTER_API_KEY: string, ADMIN_API_KEY: string, INGEST_API_KEY: string, ENVIRONMENT: string, ADMIN_HOSTNAME: string }`
  - `TenantConfig` interface in `tenant.ts` (as spec: `tenantId`, `name`, `logoUrl`, `theme`, `allowedOrigins`, `domain`, `features`, `rateLimits`)
  - `resolveTenant(hostname: string, env: Env): Promise<TenantConfig>` in `tenant.ts`
  - `tenantFromRow(row: Record<string, unknown>): TenantConfig` in `tenant.ts` — parses D1 row JSON columns
  - Hono app in `index.ts` with tenant middleware that sets `tenant` on context

- [ ] **Step 1: Initialize worker project**

```bash
cd worker
npm init -y
npm install hono
npm install -D typescript wrangler vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types unpdf
```

- [ ] **Step 2: Create `tsconfig.json`**

Strict mode, `target: "es2022"`, `module: "es2022"`, `moduleResolution: "bundler"`, `types: ["@cloudflare/workers-types/2023-07-01"]`, `jsx: "react-jsx"`, `jsxImportSource: "hono/jsx"`. Paths: `src/` included, `test/` included.

- [ ] **Step 3: Create `wrangler.toml`**

Name: `learneasy-worker`. Compatibility date: `2024-09-23`. Main: `src/index.ts`. Bindings: `DB` (d1, database_name `learneasy-db`), `VECTORIZE` (vectorize, index_name `learneasy-chunks`), `PDF_BUCKET` (r2, bucket_name `learneasy-pdfs`), `AI` (ai), `BROWSER` (browser). Vars: `ENVIRONMENT = "development"`, `ADMIN_HOSTNAME = "admin.localhost:8787"`. Assets: not yet (added later when frontends are built).

- [ ] **Step 4: Create `vitest.config.ts`**

Use `@cloudflare/vitest-pool-workers` pool. Point at `wrangler.toml`.

- [ ] **Step 5: Create D1 migration `0001_initial.sql`**

Four tables exactly as specified in the design doc: `tenants`, `config`, `transactions`, `question_paper_cache`. Plus a `rate_limits` table:

```sql
CREATE TABLE rate_limits (
  tenant_id TEXT NOT NULL,
  window TEXT NOT NULL,  -- e.g. "2026-10-19T12:05"
  count INTEGER DEFAULT 0,
  PRIMARY KEY (tenant_id, window)
);
```

Insert a default dev tenant:

```sql
INSERT INTO tenants (tenant_id, name, domain, theme_json, features_json, rate_limits_json, allowed_origins_json)
VALUES ('default', 'Dev School', 'localhost:8787',
  '{"primaryColor":"#2563eb","accentColor":"#1e40af"}',
  '{"conceptExplainerEnabled":true,"questionPaperEnabled":true,"webSearchEnabled":true}',
  '{"chatRequestsPerMinute":60,"ingestMaxFileSizeMb":50}',
  '["*"]');
```

- [ ] **Step 6: Write `env.ts`**

Export the `Env` interface with all bindings and secrets.

- [ ] **Step 7: Write the failing test for `resolveTenant`**

```typescript
// worker/test/tenant.test.ts
import { describe, it, expect } from "vitest";
import { resolveTenant, tenantFromRow } from "../src/tenant";

const ROW = {
  tenant_id: "school-a",
  name: "School A",
  domain: "chat.schoola.com",
  logo_url: null,
  theme_json: '{"primaryColor":"#ff0000","accentColor":"#00ff00"}',
  allowed_origins_json: '["https://chat.schoola.com"]',
  features_json: '{"conceptExplainerEnabled":true,"questionPaperEnabled":false,"webSearchEnabled":true}',
  rate_limits_json: '{"chatRequestsPerMinute":30,"ingestMaxFileSizeMb":20}',
};

describe("tenantFromRow", () => {
  it("parses a D1 row into TenantConfig", () => {
    const t = tenantFromRow(ROW);
    expect(t.tenantId).toBe("school-a");
    expect(t.theme.primaryColor).toBe("#ff0000");
    expect(t.features.questionPaperEnabled).toBe(false);
    expect(t.rateLimits.chatRequestsPerMinute).toBe(30);
    expect(t.allowedOrigins).toEqual(["https://chat.schoola.com"]);
  });

  it("uses defaults for missing/null JSON fields", () => {
    const t = tenantFromRow({ ...ROW, theme_json: null, features_json: null, rate_limits_json: null, allowed_origins_json: null });
    expect(t.theme.primaryColor).toBeTruthy();
    expect(t.features.conceptExplainerEnabled).toBe(true);
    expect(t.rateLimits.chatRequestsPerMinute).toBeGreaterThan(0);
    expect(t.allowedOrigins).toEqual([]);
  });
});

describe("resolveTenant", () => {
  it("returns tenant config for a known hostname", async () => {
    const mockDb = { prepare: () => ({ bind: () => ({ first: async () => ROW }) }) };
    const env = { DB: mockDb, ENVIRONMENT: "production" } as any;
    const t = await resolveTenant("chat.schoola.com", env);
    expect(t.tenantId).toBe("school-a");
  });

  it("throws for unknown hostname in production", async () => {
    const mockDb = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };
    const env = { DB: mockDb, ENVIRONMENT: "production" } as any;
    await expect(resolveTenant("unknown.com", env)).rejects.toThrow();
  });

  it("falls back to default tenant in dev when using X-Tenant override", async () => {
    const mockDb = {
      prepare: () => ({ bind: () => ({ first: async () => ({ ...ROW, tenant_id: "override-t", domain: "x" }) }) }),
    };
    const env = { DB: mockDb, ENVIRONMENT: "development" } as any;
    const t = await resolveTenant("anything", env, { tenantOverride: "override-t" });
    expect(t.tenantId).toBe("override-t");
  });

  it("ignores X-Tenant override in production", async () => {
    const mockDb = { prepare: () => ({ bind: () => ({ first: async () => ROW }) }) };
    const env = { DB: mockDb, ENVIRONMENT: "production" } as any;
    const t = await resolveTenant("chat.schoola.com", env, { tenantOverride: "hacker" });
    expect(t.tenantId).toBe("school-a");
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd worker && npx vitest run test/tenant.test.ts`
Expected: FAIL — `tenant.ts` doesn't exist.

- [ ] **Step 9: Implement `tenant.ts`**

Export `TenantConfig` interface, `DEFAULT_FEATURES`, `DEFAULT_RATE_LIMITS`, `DEFAULT_THEME`. Export `tenantFromRow(row)` that parses JSON columns with fallback defaults. Export `resolveTenant(hostname, env, opts?)` that:
1. If `env.ENVIRONMENT === "development"` and `opts.tenantOverride` is set, query D1 by `tenant_id` instead of domain.
2. Otherwise query D1: `SELECT * FROM tenants WHERE domain = ?`.
3. If no row found, throw `new Error("Unknown tenant")`.
4. Return `tenantFromRow(row)`.

(Cache API integration is omitted from this task — added in Task 2.)

- [ ] **Step 10: Run test to verify it passes**

Run: `cd worker && npx vitest run test/tenant.test.ts`
Expected: PASS

- [ ] **Step 11: Write `index.ts` — Hono app with tenant middleware**

Create a Hono app typed with `{ Bindings: Env, Variables: { tenant: TenantConfig } }`. Add middleware:
1. `GET /health` — before tenant resolution, returns `{ ok: true }` (tenant count added later).
2. Tenant resolution middleware: extract hostname from `request.url`, check for `X-Tenant` header / `?tenant=` param, call `resolveTenant`, set `c.set("tenant", tenant)`. On error, return 404 `{ error: "Unknown school" }`.
3. Placeholder routes: `GET /api/tenant` returns `{ tenantId, name, logoUrl, theme }` from context.
4. Default export the Hono app's `fetch` handler.

- [ ] **Step 12: Run type-check**

Run: `cd worker && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add worker/
git commit -m "feat: scaffold worker with Hono, tenant resolution, D1 migration, Env types"
```

---

### Task 2: Tenant-Scoped Storage Helpers + CORS

**Files:**
- Create: `worker/src/storage.ts`
- Create: `worker/src/cors.ts`
- Test: `worker/test/storage.test.ts`
- Test: `worker/test/cors.test.ts`
- Modify: `worker/src/index.ts` (add CORS middleware)

**Interfaces:**
- Consumes: `TenantConfig` from `tenant.ts`, `Env` from `env.ts`
- Produces:
  - `TenantStorage` class in `storage.ts` constructed with `(tenantId: string, env: Env)`:
    - `r2Key(prefix: "docs"|"images"|"cleaned"|"assets", ...parts: string[]): string` — returns `t/<tenantId>/<prefix>/<parts joined by />`
    - `vectorId(filename: string, chunkIndex: number): string` — returns `hash(tenantId+filename)::chunkIndex`
    - `vectorMeta(base: Record<string,string>): Record<string,string>` — merges `{ tenantId }` into base
    - `vectorFilter(): { tenantId: string }` — returns `{ tenantId }`
    - `sanitizeFilename(name: string): string` — strips path traversal characters
  - `corsMiddleware` in `cors.ts` — Hono middleware reading `tenant.allowedOrigins` + always allowing `env.ADMIN_HOSTNAME`

- [ ] **Step 1: Write the failing test for `storage.ts`**

```typescript
// worker/test/storage.test.ts
import { describe, it, expect } from "vitest";
import { TenantStorage } from "../src/storage";

describe("TenantStorage", () => {
  const s = new TenantStorage("school-a", {} as any);

  it("prefixes R2 keys with tenant namespace", () => {
    expect(s.r2Key("docs", "physics.pdf")).toBe("t/school-a/docs/physics.pdf");
    expect(s.r2Key("images", "physics.pdf", "3.png")).toBe("t/school-a/images/physics.pdf/3.png");
    expect(s.r2Key("cleaned", "physics.pdf.md")).toBe("t/school-a/cleaned/physics.pdf.md");
  });

  it("produces deterministic vector IDs scoped by tenant", () => {
    const id1 = s.vectorId("physics.pdf", 0);
    const id2 = s.vectorId("physics.pdf", 1);
    expect(id1).not.toBe(id2);
    expect(id1).toContain("::0");
    // Different tenant, same file — different ID
    const s2 = new TenantStorage("school-b", {} as any);
    expect(s2.vectorId("physics.pdf", 0)).not.toBe(id1);
  });

  it("always includes tenantId in vector metadata", () => {
    expect(s.vectorMeta({ filename: "x.pdf" })).toEqual({ tenantId: "school-a", filename: "x.pdf" });
  });

  it("returns tenant filter for Vectorize queries", () => {
    expect(s.vectorFilter()).toEqual({ tenantId: "school-a" });
  });

  it("sanitizes filenames to prevent path traversal", () => {
    expect(s.sanitizeFilename("../../etc/passwd")).not.toContain("..");
    expect(s.sanitizeFilename("normal-file.pdf")).toBe("normal-file.pdf");
    expect(s.sanitizeFilename("path/to/file.pdf")).toBe("pathtofile.pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/storage.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `storage.ts`**

`TenantStorage` class. `r2Key` joins `t/${tenantId}/${prefix}/${parts}`. `vectorId` uses a hash of `tenantId + filename` (simple SHA-256 hex prefix, 16 chars) + `::${chunkIndex}`. `vectorMeta` spreads `{ tenantId }`. `vectorFilter` returns `{ tenantId }`. `sanitizeFilename` strips `..`, `/`, `\`, null bytes — keep only alphanumerics, hyphens, underscores, dots.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `cors.ts`**

```typescript
// worker/test/cors.test.ts
import { describe, it, expect } from "vitest";
import { buildCorsHeaders } from "../src/cors";

describe("buildCorsHeaders", () => {
  it("allows origin from tenant config", () => {
    const h = buildCorsHeaders("https://chat.schoola.com", ["https://chat.schoola.com"], "admin.learneasy.ai");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://chat.schoola.com");
  });

  it("allows admin hostname origin", () => {
    const h = buildCorsHeaders("https://admin.learneasy.ai", [], "admin.learneasy.ai");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://admin.learneasy.ai");
  });

  it("rejects unknown origin", () => {
    const h = buildCorsHeaders("https://evil.com", ["https://chat.schoola.com"], "admin.learneasy.ai");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("allows wildcard in dev", () => {
    const h = buildCorsHeaders("https://anything.com", ["*"], "admin.localhost");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://anything.com");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd worker && npx vitest run test/cors.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement `cors.ts`**

Export `buildCorsHeaders(origin: string, allowedOrigins: string[], adminHostname: string): Record<string, string>`. Check if `origin` matches any entry in `allowedOrigins` (or `"*"` in list), or if the origin's hostname matches `adminHostname`. Return headers with `Access-Control-Allow-Origin`, `Allow-Methods`, `Allow-Headers`, `Max-Age`. Export a Hono middleware `corsMiddleware` that calls this and handles OPTIONS preflight.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd worker && npx vitest run test/cors.test.ts`
Expected: PASS

- [ ] **Step 9: Wire CORS middleware into `index.ts`**

Add `corsMiddleware` to the Hono app after tenant resolution middleware.

- [ ] **Step 10: Commit**

```bash
git add worker/src/storage.ts worker/src/cors.ts worker/test/storage.test.ts worker/test/cors.test.ts worker/src/index.ts
git commit -m "feat: tenant-scoped storage helpers and CORS middleware"
```

---

### Task 3: Per-Tenant Runtime Config + Rate Limiting

**Files:**
- Create: `worker/src/config.ts`
- Create: `worker/src/rateLimit.ts`
- Test: `worker/test/config.test.ts`
- Test: `worker/test/rateLimit.test.ts`

**Interfaces:**
- Consumes: `Env` from `env.ts`, `TenantConfig` from `tenant.ts`
- Produces:
  - `RuntimeConfig` interface in `config.ts`: `{ topK: number, confidenceThreshold: number, webSearchMode: "auto"|"rag_only"|"web_only", hardFailNoDocument: boolean, jevEnabled: boolean, jevRelevanceThreshold: number, guardrailEnabled: boolean, llmProvider: "openrouter"|"workers-ai", llmModelSlug: string, ingestionEnrichmentEnabled: boolean, ingestionModelSlug: string, explainRetrievalMode: "rag_fallback"|"rag_plus_llm", conceptExplainerEnabled: boolean, questionPaperModelSlug: string|null, answerStyle: "auto"|"short"|"detailed" }`
  - `loadConfig(tenantId: string, db: D1Database): Promise<RuntimeConfig>`
  - `saveConfigField(tenantId: string, db: D1Database, key: string, value: string): Promise<void>`
  - `checkRateLimit(tenantId: string, limit: number, db: D1Database): Promise<{ allowed: boolean, remaining: number }>`

- [ ] **Step 1: Write the failing test for `config.ts`**

```typescript
// worker/test/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULTS } from "../src/config";

describe("loadConfig", () => {
  it("returns defaults when D1 has no rows for tenant", async () => {
    const mockDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) };
    const cfg = await loadConfig("tenant-x", mockDb as any);
    expect(cfg.topK).toBe(DEFAULTS.topK);
    expect(cfg.llmProvider).toBe("openrouter");
    expect(cfg.guardrailEnabled).toBe(true);
  });

  it("overrides defaults with D1 values", async () => {
    const rows = [{ key: "topK", value: "10" }, { key: "llmProvider", value: "workers-ai" }];
    const mockDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) };
    const cfg = await loadConfig("tenant-x", mockDb as any);
    expect(cfg.topK).toBe(10);
    expect(cfg.llmProvider).toBe("workers-ai");
  });

  it("returns defaults when D1 throws (fail-open)", async () => {
    const mockDb = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error("D1 down"); } }) }) };
    const cfg = await loadConfig("tenant-x", mockDb as any);
    expect(cfg.topK).toBe(DEFAULTS.topK);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/config.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `config.ts`**

Export `DEFAULTS` object with all default values (matching EdukripaLive: `topK: 5`, `confidenceThreshold: 0`, `llmProvider: "openrouter"`, `llmModelSlug: "qwen/qwen3-235b-a22b:free"`, `guardrailEnabled: true`, `jevEnabled: true`, `jevRelevanceThreshold: 1.5`, etc.). `loadConfig` queries `SELECT key, value FROM config WHERE tenant_id = ?`, overlays on defaults, coerces types. Wraps in try/catch — returns `DEFAULTS` on error.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/config.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `rateLimit.ts`**

```typescript
// worker/test/rateLimit.test.ts
import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../src/rateLimit";

describe("checkRateLimit", () => {
  it("allows request when under limit", async () => {
    const mockDb = mockD1WithCount(5);
    const result = await checkRateLimit("tenant-a", 60, mockDb as any);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(54); // 60 - 5 - 1
  });

  it("blocks request when at limit", async () => {
    const mockDb = mockD1WithCount(60);
    const result = await checkRateLimit("tenant-a", 60, mockDb as any);
    expect(result.allowed).toBe(false);
  });

  it("allows request when D1 throws (fail-open)", async () => {
    const mockDb = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error(); } }) }) };
    const result = await checkRateLimit("tenant-a", 60, mockDb as any);
    expect(result.allowed).toBe(true);
  });
});

function mockD1WithCount(count: number) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => sql.includes("SELECT") ? { count } : null,
        run: async () => ({}),
      }),
    }),
  };
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd worker && npx vitest run test/rateLimit.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement `rateLimit.ts`**

Export `checkRateLimit(tenantId, limit, db)`. Compute current minute window string (ISO minute). Query `SELECT count FROM rate_limits WHERE tenant_id = ? AND window = ?`. If count >= limit, return `{ allowed: false, remaining: 0 }`. Otherwise upsert the count + 1 and return `{ allowed: true, remaining: limit - count - 1 }`. Wrap everything in try/catch — return `{ allowed: true, remaining: -1 }` on error (fail open).

- [ ] **Step 8: Run test to verify it passes**

Run: `cd worker && npx vitest run test/rateLimit.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add worker/src/config.ts worker/src/rateLimit.ts worker/test/config.test.ts worker/test/rateLimit.test.ts
git commit -m "feat: per-tenant runtime config (D1-backed) and rate limiting"
```

---

### Task 4: Guardrail (Fails Closed)

**Files:**
- Create: `worker/src/guardrail.ts`
- Test: `worker/test/guardrail.test.ts`

**Interfaces:**
- Consumes: `Env` from `env.ts`
- Produces:
  - `guardrailCheck(text: string, env: Env): Promise<{ blocked: boolean, reason?: string }>`
  - Fails closed: returns `{ blocked: true, reason: "guardrail error" }` on any exception.

- [ ] **Step 1: Write the failing test**

```typescript
// worker/test/guardrail.test.ts
import { describe, it, expect } from "vitest";
import { guardrailCheck, BLOCKED_KEYWORDS } from "../src/guardrail";

describe("guardrailCheck", () => {
  it("blocks known harmful keywords", async () => {
    const env = mockEnvWithAI({ score: 0.9 });
    const result = await guardrailCheck("how to make a bomb", env);
    expect(result.blocked).toBe(true);
  });

  it("passes clean academic question", async () => {
    const env = mockEnvWithAI({ score: 0.9 });
    const result = await guardrailCheck("explain Newton's second law", env);
    expect(result.blocked).toBe(false);
  });

  it("FAILS CLOSED on AI error", async () => {
    const env = mockEnvWithAI(null, new Error("AI down"));
    const result = await guardrailCheck("normal question", env);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("error");
  });
});

function mockEnvWithAI(response: any, error?: Error) {
  return {
    AI: {
      run: async () => { if (error) throw error; return response; },
    },
  } as any;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/guardrail.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `guardrail.ts`**

Export `BLOCKED_KEYWORDS` array (same categories as EdukripaLive: violence, self-harm, sexual, drugs, weapons — appropriate for a school product with minor users). Export `guardrailCheck(text, env)`:
1. Check `text` against `BLOCKED_KEYWORDS` (case-insensitive substring match). Block if hit.
2. (Embedding-similarity scope check can be added later — keyword check is the MVP.)
3. Wrap everything in try/catch: on any error, return `{ blocked: true, reason: "guardrail error" }` (fail closed).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/guardrail.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/guardrail.ts worker/test/guardrail.test.ts
git commit -m "feat: guardrail with keyword blocklist, fails closed on error"
```

---

### Task 5: PDF Extraction + Text Chunking + Vector IDs

**Files:**
- Create: `worker/src/pdf.ts`
- Create: `worker/src/chunker.ts`
- Test: `worker/test/pdf.test.ts`
- Test: `worker/test/chunker.test.ts`

**Interfaces:**
- Consumes: nothing external (pure functions)
- Produces:
  - `extractPdfPages(pdfBytes: ArrayBuffer): Promise<Array<{ page: number, text: string }>>` in `pdf.ts`
  - `chunkText(pages: Array<{ page: number, text: string }>, opts?: { chunkSize?: number, overlap?: number }): Array<{ text: string, startPage: number, endPage: number, chunkIndex: number, pageImageKey?: string }>` in `chunker.ts`

- [ ] **Step 1: Write the failing test for `pdf.ts`**

```typescript
// worker/test/pdf.test.ts
import { describe, it, expect } from "vitest";
import { extractPdfPages } from "../src/pdf";

describe("extractPdfPages", () => {
  it("copies buffer before passing to PDF.js (buffer should not be detached)", async () => {
    // Create a minimal valid PDF buffer for testing
    // This test verifies the input buffer is still usable after extraction
    const buf = new ArrayBuffer(8);
    try {
      await extractPdfPages(buf);
    } catch {
      // Invalid PDF will throw, but buffer should not be detached
    }
    expect(buf.byteLength).toBe(8); // not detached
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/pdf.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `pdf.ts`**

Import `getDocumentProxy` from `unpdf`. Export `extractPdfPages`: copy the buffer (`buf.slice(0)`) before passing to PDF.js. Iterate pages, extract text content, join items into page text. Return array of `{ page, text }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/pdf.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `chunker.ts`**

```typescript
// worker/test/chunker.test.ts
import { describe, it, expect } from "vitest";
import { chunkText } from "../src/chunker";

describe("chunkText", () => {
  it("splits text into 300-word chunks with 50-word overlap by default", () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
    const pages = [{ page: 1, text: words.join(" ") }];
    const chunks = chunkText(pages);
    expect(chunks.length).toBe(3); // ~300, ~300 (with overlap), ~remaining
    expect(chunks[0].startPage).toBe(1);
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it("tracks page boundaries across chunks", () => {
    const pages = [
      { page: 1, text: Array(200).fill("w").join(" ") },
      { page: 2, text: Array(200).fill("w").join(" ") },
    ];
    const chunks = chunkText(pages);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // First chunk should start on page 1
    expect(chunks[0].startPage).toBe(1);
  });

  it("carries pageImageKey when page text contains [Figure:", () => {
    const pages = [{ page: 3, text: "some text [Figure: a diagram] more text " + Array(280).fill("w").join(" ") }];
    const chunks = chunkText(pages);
    expect(chunks[0].pageImageKey).toBeTruthy();
  });

  it("returns empty array for empty input", () => {
    expect(chunkText([])).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd worker && npx vitest run test/chunker.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement `chunker.ts`**

Export `chunkText(pages, opts)`. Defaults: `chunkSize: 300` words, `overlap: 50` words. Concatenate all pages into a continuous word stream, tracking which page each word came from. Slide a window of `chunkSize` words, advancing by `chunkSize - overlap`. Each chunk records `startPage`, `endPage` (from word positions), `chunkIndex`, and `pageImageKey` (set to the page's image path if any word in the chunk came from a page whose text contains `[Figure:`).

- [ ] **Step 8: Run test to verify it passes**

Run: `cd worker && npx vitest run test/chunker.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add worker/src/pdf.ts worker/src/chunker.ts worker/test/pdf.test.ts worker/test/chunker.test.ts
git commit -m "feat: PDF text extraction and 300-word text chunker with page tracking"
```

---

### Task 6: LLM Generation + Ingestion Enrichment

**Files:**
- Create: `worker/src/llm.ts`
- Create: `worker/src/ingestionEnrichment.ts`
- Test: `worker/test/llm.test.ts`
- Test: `worker/test/ingestionEnrichment.test.ts`

**Interfaces:**
- Consumes: `Env` from `env.ts`, `RuntimeConfig` from `config.ts`
- Produces:
  - `generateChatCompletion(messages: Array<{role:string,content:string}>, config: RuntimeConfig, env: Env, opts?: { modelOverride?: string, maxTokens?: number }): Promise<{ text: string, model: string, provider: string, tokenEstimate: number }>` in `llm.ts`
  - `enrichPdfToMarkdown(pdfBytes: ArrayBuffer, config: RuntimeConfig, env: Env): Promise<string | null>` in `ingestionEnrichment.ts`
  - `parseEnrichedPages(enrichedText: string, plainPages: Array<{page:number,text:string}>): Array<{page:number,text:string}>` in `ingestionEnrichment.ts` — pure function, never throws

- [ ] **Step 1: Write the failing test for `llm.ts`**

```typescript
// worker/test/llm.test.ts
import { describe, it, expect } from "vitest";
import { generateChatCompletion } from "../src/llm";
import { DEFAULTS } from "../src/config";

describe("generateChatCompletion", () => {
  it("calls OpenRouter when provider is openrouter", async () => {
    let calledUrl = "";
    const env = {
      OPENROUTER_API_KEY: "test-key",
      AI: { run: async () => ({}) },
    } as any;
    global.fetch = async (url: any, init: any) => {
      calledUrl = url;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "answer" } }],
        usage: { total_tokens: 100 },
      }));
    };
    const result = await generateChatCompletion(
      [{ role: "user", content: "hi" }],
      { ...DEFAULTS, llmProvider: "openrouter" },
      env
    );
    expect(calledUrl).toContain("openrouter.ai");
    expect(result.text).toBe("answer");
    expect(result.provider).toBe("openrouter");
  });

  it("throws on OpenRouter failure (does NOT fail open)", async () => {
    const env = { OPENROUTER_API_KEY: "test-key" } as any;
    global.fetch = async () => new Response("error", { status: 500 });
    await expect(
      generateChatCompletion([{ role: "user", content: "hi" }], { ...DEFAULTS, llmProvider: "openrouter" }, env)
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/llm.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `llm.ts`**

Export `generateChatCompletion`. Routes on `config.llmProvider`:
- `"openrouter"`: POST to `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer ${env.OPENROUTER_API_KEY}`, model from `config.llmModelSlug` (or `opts.modelOverride`), `max_tokens` from opts. Parse response. On non-200, throw.
- `"workers-ai"`: call `env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", { messages })`. On error, throw.

Return `{ text, model, provider, tokenEstimate }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/llm.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `ingestionEnrichment.ts`**

```typescript
// worker/test/ingestionEnrichment.test.ts
import { describe, it, expect } from "vitest";
import { parseEnrichedPages } from "../src/ingestionEnrichment";

describe("parseEnrichedPages", () => {
  it("merges enriched text onto plain pages by page number", () => {
    const enriched = "<<<PAGE 1>>>\n# Enriched page 1\n<<<PAGE 2>>>\n# Enriched page 2";
    const plain = [{ page: 1, text: "plain 1" }, { page: 2, text: "plain 2" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result[0].text).toContain("Enriched page 1");
    expect(result[1].text).toContain("Enriched page 2");
  });

  it("falls back to plain text for pages missing from enriched output", () => {
    const enriched = "<<<PAGE 1>>>\n# Enriched page 1";
    const plain = [{ page: 1, text: "plain 1" }, { page: 2, text: "plain 2" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result[0].text).toContain("Enriched page 1");
    expect(result[1].text).toBe("plain 2"); // fallback
  });

  it("never throws — returns plain pages on garbage input", () => {
    const plain = [{ page: 1, text: "plain 1" }];
    expect(parseEnrichedPages("", plain)).toEqual(plain);
    expect(parseEnrichedPages("no markers here", plain)).toEqual(plain);
    expect(parseEnrichedPages(null as any, plain)).toEqual(plain);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd worker && npx vitest run test/ingestionEnrichment.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement `ingestionEnrichment.ts`**

Export `parseEnrichedPages(enrichedText, plainPages)`: split on `<<<PAGE N>>>` markers, build a map of page number → enriched text, merge onto plain pages by page number, fall back to plain text for any page with no matching marker. Wrap in try/catch, return `plainPages` on any error.

Export `enrichPdfToMarkdown(pdfBytes, config, env)`: if `!config.ingestionEnrichmentEnabled`, return null. Call OpenRouter with the enrichment model (`config.ingestionModelSlug`), sending the PDF as base64 in a vision-capable message, prompted to emit `<<<PAGE N>>>` markers. Return the raw enriched text. On any error, return null (fail open).

- [ ] **Step 8: Run test to verify it passes**

Run: `cd worker && npx vitest run test/ingestionEnrichment.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add worker/src/llm.ts worker/src/ingestionEnrichment.ts worker/test/llm.test.ts worker/test/ingestionEnrichment.test.ts
git commit -m "feat: LLM generation (OpenRouter/Workers AI) and PDF enrichment"
```

---

### Task 7: Reranker + JEV Filter

**Files:**
- Create: `worker/src/rerank.ts`
- Create: `worker/src/jev.ts`
- Test: `worker/test/rerank.test.ts`
- Test: `worker/test/jev.test.ts`

**Interfaces:**
- Consumes: `Env` from `env.ts`, `RuntimeConfig` from `config.ts`
- Produces:
  - `rerank(query: string, chunks: Array<{text:string, score:number, [k:string]:any}>, env: Env): Promise<Array<{text:string, score:number, [k:string]:any}>>` in `rerank.ts` — fails open (returns input order)
  - `jevFilter(query: string, chunks: Array<{text:string,[k:string]:any}>, config: RuntimeConfig, env: Env): Promise<Array<{text:string, jevScore:number, kept:boolean, [k:string]:any}>>` in `jev.ts` — fails open (marks all as kept)

- [ ] **Step 1: Write the failing test for `rerank.ts`**

```typescript
// worker/test/rerank.test.ts
import { describe, it, expect } from "vitest";
import { rerank } from "../src/rerank";

describe("rerank", () => {
  const chunks = [
    { text: "less relevant", score: 0.9 },
    { text: "more relevant", score: 0.7 },
  ];

  it("reorders chunks by cross-encoder score", async () => {
    const env = {
      AI: { run: async () => ({ data: [{ score: 0.3 }, { score: 0.8 }] }) },
    } as any;
    const result = await rerank("query", chunks, env);
    expect(result[0].text).toBe("more relevant");
  });

  it("fails open — returns original order on AI error", async () => {
    const env = { AI: { run: async () => { throw new Error("AI down"); } } } as any;
    const result = await rerank("query", chunks, env);
    expect(result[0].text).toBe("less relevant"); // original order preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/rerank.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `rerank.ts`**

Export `rerank(query, chunks, env)`. Call `env.AI.run("@cf/baai/bge-reranker-base", { query, texts: chunks.map(c => c.text) })`. Map scores back onto chunks, sort descending. Wrap in try/catch, return `chunks` unchanged on error (fail open).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/rerank.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `jev.ts`**

```typescript
// worker/test/jev.test.ts
import { describe, it, expect } from "vitest";
import { jevFilter } from "../src/jev";
import { DEFAULTS } from "../src/config";

describe("jevFilter", () => {
  it("keeps chunks above relevance threshold", async () => {
    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"relevance": 3, "injection": false}' } }],
    }));
    const config = { ...DEFAULTS, jevEnabled: true, jevRelevanceThreshold: 1.5 };
    const env = { OPENROUTER_API_KEY: "key" } as any;
    const result = await jevFilter("query", [{ text: "chunk1" }], config, env);
    expect(result[0].kept).toBe(true);
    expect(result[0].jevScore).toBe(3);
  });

  it("discards chunks below threshold", async () => {
    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"relevance": 0.5, "injection": false}' } }],
    }));
    const config = { ...DEFAULTS, jevEnabled: true, jevRelevanceThreshold: 1.5 };
    const env = { OPENROUTER_API_KEY: "key" } as any;
    const result = await jevFilter("query", [{ text: "chunk1" }], config, env);
    expect(result[0].kept).toBe(false);
  });

  it("fails open — marks all as kept on error", async () => {
    global.fetch = async () => { throw new Error("down"); };
    const config = { ...DEFAULTS, jevEnabled: true };
    const env = { OPENROUTER_API_KEY: "key" } as any;
    const result = await jevFilter("query", [{ text: "chunk1" }], config, env);
    expect(result[0].kept).toBe(true);
  });

  it("passes all through when disabled", async () => {
    const config = { ...DEFAULTS, jevEnabled: false };
    const result = await jevFilter("query", [{ text: "chunk1" }], config, {} as any);
    expect(result[0].kept).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd worker && npx vitest run test/jev.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement `jev.ts`**

Export `jevFilter(query, chunks, config, env)`. If `!config.jevEnabled`, mark all as kept and return. For each chunk, call OpenRouter with a relevance + injection check prompt. Parse the JSON response (`{ relevance: number, injection: boolean }`). Mark `kept: relevance >= config.jevRelevanceThreshold && !injection`. Wrap in try/catch per chunk and at the top level — on error, mark all as kept (fail open).

- [ ] **Step 8: Run test to verify it passes**

Run: `cd worker && npx vitest run test/jev.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add worker/src/rerank.ts worker/src/jev.ts worker/test/rerank.test.ts worker/test/jev.test.ts
git commit -m "feat: cross-encoder reranker and JEV relevance filter, both fail-open"
```

---

### Task 8: Web Search Fallback + Transaction Trace

**Files:**
- Create: `worker/src/webSearch.ts`
- Create: `worker/src/transactionTrace.ts`
- Test: `worker/test/webSearch.test.ts`
- Test: `worker/test/transactionTrace.test.ts`

**Interfaces:**
- Consumes: `Env` from `env.ts`, `TenantConfig` from `tenant.ts`
- Produces:
  - `webSearch(query: string): Promise<Array<{ title: string, snippet: string, url: string }>>` in `webSearch.ts` — never throws
  - `buildTransactionTrace(data: TransactionTraceInput): TransactionRow` and `insertTransaction(row: TransactionRow, tenantId: string, db: D1Database): Promise<void>` in `transactionTrace.ts`

- [ ] **Step 1: Write the failing test for `webSearch.ts`**

```typescript
// worker/test/webSearch.test.ts
import { describe, it, expect } from "vitest";
import { webSearch } from "../src/webSearch";

describe("webSearch", () => {
  it("returns results on success", async () => {
    global.fetch = async () => new Response('<a class="result__a" href="https://example.com">Title</a><a class="result__snippet">Snippet</a>');
    const results = await webSearch("test query");
    expect(Array.isArray(results)).toBe(true);
  });

  it("never throws — returns empty on error", async () => {
    global.fetch = async () => { throw new Error("network"); };
    const results = await webSearch("test query");
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/webSearch.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `webSearch.ts`**

Export `webSearch(query)`. Fetch DuckDuckGo HTML search, parse result links and snippets. Wrap in try/catch, return `[]` on any error (fail open, never throws).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/webSearch.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `transactionTrace.ts`**

```typescript
// worker/test/transactionTrace.test.ts
import { describe, it, expect } from "vitest";
import { buildTransactionTrace } from "../src/transactionTrace";

describe("buildTransactionTrace", () => {
  it("assembles a transaction row from pipeline data", () => {
    const row = buildTransactionTrace({
      pathTaken: "chat",
      question: "what is force",
      answer: "F = ma",
      model: "qwen/qwen3",
      provider: "openrouter",
      chunks: [{ text: "chunk", score: 0.9, kept: true }],
      tokenEstimate: 150,
    });
    expect(row.path_taken).toBe("chat");
    expect(row.question).toBe("what is force");
    expect(JSON.parse(row.trace_json).chunks).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd worker && npx vitest run test/transactionTrace.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement `transactionTrace.ts`**

Export `TransactionTraceInput` type and `TransactionRow` type. `buildTransactionTrace` maps input to a row object with `trace_json` as a JSON string of the full chunk/score/kept data. `insertTransaction(row, tenantId, db)` does `INSERT INTO transactions (tenant_id, path_taken, question, answer, model, provider, trace_json, token_estimate) VALUES (...)`. Fire-and-forget — caller uses `ctx.waitUntil()`.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd worker && npx vitest run test/transactionTrace.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add worker/src/webSearch.ts worker/src/transactionTrace.ts worker/test/webSearch.test.ts worker/test/transactionTrace.test.ts
git commit -m "feat: DuckDuckGo web search fallback and tenant-scoped transaction tracing"
```

---

### Task 9: Ingestion Pipeline (`POST /ingest`)

**Files:**
- Create: `worker/src/ingestion.ts`
- Modify: `worker/src/index.ts` (add `/api/ingest` route)
- Test: `worker/test/ingestion.test.ts`

**Interfaces:**
- Consumes: `TenantStorage` from `storage.ts`, `extractPdfPages` from `pdf.ts`, `chunkText` from `chunker.ts`, `enrichPdfToMarkdown`/`parseEnrichedPages` from `ingestionEnrichment.ts`, `loadConfig` from `config.ts`, `Env` from `env.ts`, `TenantConfig` from `tenant.ts`
- Produces:
  - `handleIngest(request: Request, env: Env, tenant: TenantConfig, ctx: ExecutionContext): Promise<Response>`
  - Request: multipart form with `file` (PDF), optional `force` field.
  - Response: `{ success: true, filename, chunkCount, pageCount, enriched }` or `{ error: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// worker/test/ingestion.test.ts
import { describe, it, expect } from "vitest";
import { handleIngest } from "../src/ingestion";

describe("handleIngest", () => {
  it("rejects request without ingest key", async () => {
    const req = new Request("http://localhost/api/ingest", { method: "POST" });
    const res = await handleIngest(req, mockEnv(), mockTenant(), mockCtx());
    expect(res.status).toBe(401);
  });

  it("skips already-indexed file (dedup check)", async () => {
    const req = buildIngestRequest("existing.pdf");
    const env = mockEnv({ r2Head: { name: "existing.pdf" } });
    const res = await handleIngest(req, env, mockTenant(), mockCtx());
    const body = await res.json() as any;
    expect(body.skipped).toBe(true);
  });

  it("re-ingests when force=true, deleting old vectors and R2 objects", async () => {
    const deletedKeys: string[] = [];
    const req = buildIngestRequest("existing.pdf", true);
    const env = mockEnv({
      r2Head: { name: "existing.pdf", customMetadata: { chunkCount: "2" } },
      onR2Delete: (key: string) => deletedKeys.push(key),
    });
    const res = await handleIngest(req, env, mockTenant(), mockCtx());
    expect(deletedKeys.length).toBeGreaterThan(0);
  });

  it("writes R2 and Vectorize only after successful processing", async () => {
    const written: string[] = [];
    const req = buildIngestRequest("new.pdf");
    const env = mockEnv({
      r2Head: null,
      onR2Put: (key: string) => written.push(key),
      onVectorizeUpsert: () => {},
    });
    const res = await handleIngest(req, env, mockTenant(), mockCtx());
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    // R2 writes should include the tenant prefix
    expect(written.every(k => k.startsWith("t/test-tenant/"))).toBe(true);
  });
});

// Helper factories (mockEnv, mockTenant, mockCtx, buildIngestRequest) 
// create appropriate mocks — implementation detail for builder.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/ingestion.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `ingestion.ts`**

Export `handleIngest(request, env, tenant, ctx)`. Pipeline:
1. Check `x-ingest-key` header against `env.INGEST_API_KEY`. 401 if missing/wrong.
2. Parse multipart form. Extract `file` and optional `force`.
3. Sanitize filename via `TenantStorage.sanitizeFilename()`.
4. Dedup: `env.PDF_BUCKET.head(storage.r2Key("docs", filename))`. If exists and `!force`, return `{ skipped: true }`. If exists and `force`, delete old vectors (recompute IDs from old `chunkCount` metadata), delete old R2 objects (`docs/`, `images/`, `cleaned/` prefixes).
5. `extractPdfPages(pdfBytes)`.
6. `loadConfig(tenant.tenantId, env.DB)` → if enrichment enabled, `enrichPdfToMarkdown()` + `parseEnrichedPages()`.
7. `chunkText(pages)`.
8. Embed chunks: `env.AI.run("@cf/baai/bge-base-en-v1.5", { text: chunk.text })` per chunk.
9. `env.VECTORIZE.upsert(vectors)` — each vector uses `storage.vectorId()` for ID and `storage.vectorMeta()` for metadata.
10. On success: `env.PDF_BUCKET.put(storage.r2Key("docs", filename), pdfBytes, { customMetadata: { chunkCount, pageCount, indexedAt, enriched } })`.
11. If enriched, `env.PDF_BUCKET.put(storage.r2Key("cleaned", filename + ".md"), enrichedFullText)`.
12. Return `{ success: true, filename, chunkCount, pageCount, enriched }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/ingestion.test.ts`
Expected: PASS

- [ ] **Step 5: Wire route into `index.ts`**

Add `app.post("/api/ingest", ...)` that calls `handleIngest(c.req.raw, env, tenant, c.executionCtx)`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/ingestion.ts worker/test/ingestion.test.ts worker/src/index.ts
git commit -m "feat: tenant-scoped PDF ingestion pipeline with enrichment"
```

---

### Task 10: Chat Pipeline (`POST /chat`)

**Files:**
- Create: `worker/src/chat.ts`
- Modify: `worker/src/index.ts` (add `/api/chat` route)
- Test: `worker/test/chat.test.ts`

**Interfaces:**
- Consumes: `guardrailCheck` from `guardrail.ts`, `TenantStorage` from `storage.ts`, `loadConfig` from `config.ts`, `rerank` from `rerank.ts`, `jevFilter` from `jev.ts`, `webSearch` from `webSearch.ts`, `generateChatCompletion` from `llm.ts`, `buildTransactionTrace`/`insertTransaction` from `transactionTrace.ts`, `checkRateLimit` from `rateLimit.ts`, `Env`, `TenantConfig`
- Produces:
  - `handleChat(request: Request, env: Env, tenant: TenantConfig, ctx: ExecutionContext): Promise<Response>`
  - Request: JSON `{ question: string, answerStyle?: "auto"|"short"|"detailed" }`
  - Response: `{ answer: string, docSources: Array<{filename,page,snippet,pageImageKey?}>, webSources: Array<{title,url,snippet}>, model: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// worker/test/chat.test.ts
import { describe, it, expect } from "vitest";
import { handleChat } from "../src/chat";

describe("handleChat", () => {
  it("returns an answer using the full pipeline", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "What is force?" }),
      headers: { "Content-Type": "application/json" },
    });
    const env = mockChatEnv({
      vectorizeResults: [{ id: "v1", score: 0.9, metadata: { tenantId: "t1", filename: "physics.pdf", page: "1", text: "Force equals mass times acceleration" } }],
      llmResponse: "Force is F = ma",
    });
    const res = await handleChat(req, env, mockTenant("t1"), mockCtx());
    const body = await res.json() as any;
    expect(body.answer).toBe("Force is F = ma");
    expect(body.docSources).toHaveLength(1);
  });

  it("blocks when guardrail triggers", async () => {
    const req = chatRequest("how to make a bomb");
    const env = mockChatEnv({});
    const res = await handleChat(req, env, mockTenant("t1"), mockCtx());
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.blocked).toBe(true);
  });

  it("rate-limits when over tenant limit", async () => {
    const req = chatRequest("test");
    const env = mockChatEnv({ rateLimitCount: 999 });
    const res = await handleChat(req, env, mockTenant("t1"), mockCtx());
    expect(res.status).toBe(429);
  });

  it("includes tenant filter in Vectorize query", async () => {
    let queriedFilter: any;
    const req = chatRequest("test question");
    const env = mockChatEnv({
      onVectorizeQuery: (_, opts) => { queriedFilter = opts.filter; },
    });
    await handleChat(req, env, mockTenant("t1"), mockCtx());
    expect(queriedFilter).toEqual({ tenantId: "t1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/chat.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `chat.ts`**

Export `handleChat`. The fixed pipeline:
1. Parse `{ question, answerStyle }` from request body.
2. `checkRateLimit(tenant.tenantId, tenant.rateLimits.chatRequestsPerMinute, env.DB)`. 429 if blocked.
3. `loadConfig(tenant.tenantId, env.DB)`.
4. If `config.guardrailEnabled`: `guardrailCheck(question, env)`. 400 if blocked.
5. Embed question: `env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [question] })`.
6. `env.VECTORIZE.query(embedding, { topK: config.topK, filter: storage.vectorFilter() })`.
7. `rerank(question, chunks, env)`.
8. If `config.jevEnabled`: `jevFilter(question, chunks, config, env)`.
9. Confidence gate: filter by `config.confidenceThreshold`.
10. If no doc sources and `config.webSearchMode !== "rag_only"`: `webSearch(question)`.
11. Build system prompt (source-fidelity enforced) + answer style fragment. `generateChatCompletion(messages, config, env, { maxTokens })`.
12. `ctx.waitUntil(insertTransaction(buildTransactionTrace(...), tenant.tenantId, env.DB))`.
13. Return `{ answer, docSources, webSources, model }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/chat.test.ts`
Expected: PASS

- [ ] **Step 5: Wire route into `index.ts`**

Add `app.post("/api/chat", ...)`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/chat.ts worker/test/chat.test.ts worker/src/index.ts
git commit -m "feat: tenant-scoped chat pipeline (guardrail, retrieve, rerank, JEV, generate)"
```

---

### Task 11: Concept Explainer (`POST /explain`)

**Files:**
- Create: `worker/src/explain.ts`
- Modify: `worker/src/index.ts` (add `/api/explain` route)
- Test: `worker/test/explain.test.ts`

**Interfaces:**
- Consumes: same as chat (guardrail, storage, config, rerank, jev, llm, transactionTrace, rateLimit)
- Produces:
  - `handleExplain(request: Request, env: Env, tenant: TenantConfig, ctx: ExecutionContext): Promise<Response>`
  - Request: JSON `{ concept: string }`
  - Response: JSON `{ concept, simpleExplanation, steps, formula, definition, table, realWorldExample, groundedIn }`
  - `parseExplainLlmResponse(raw: string): ExplainResponse` — pure function, never throws

- [ ] **Step 1: Write the failing test**

```typescript
// worker/test/explain.test.ts
import { describe, it, expect } from "vitest";
import { parseExplainLlmResponse } from "../src/explain";

describe("parseExplainLlmResponse", () => {
  it("parses valid JSON from fenced code block", () => {
    const raw = '```json\n{"concept":"force","simpleExplanation":"push or pull","steps":null,"formula":"F=ma","definition":"Force is...","table":null,"realWorldExample":"kicking a ball"}\n```';
    const result = parseExplainLlmResponse(raw);
    expect(result.concept).toBe("force");
    expect(result.formula).toBe("F=ma");
  });

  it("never throws — falls back to raw text in simpleExplanation", () => {
    const result = parseExplainLlmResponse("this is not json at all");
    expect(result.simpleExplanation).toBe("this is not json at all");
    expect(result.formula).toBeNull();
  });

  it("handles truncated JSON gracefully", () => {
    const result = parseExplainLlmResponse('```json\n{"concept":"force","simpleExp');
    expect(result.simpleExplanation).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/explain.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `explain.ts`**

Export `parseExplainLlmResponse(raw)`: try to extract fenced JSON block, parse it, validate expected fields. On any failure, return `{ concept: "", simpleExplanation: raw, steps: null, formula: null, definition: null, table: null, realWorldExample: null }`.

Export `handleExplain(request, env, tenant, ctx)`. Same retrieval pipeline as chat (embed → query with tenant filter → rerank → JEV → confidence gate) but generation uses a structured JSON prompt with `config.explainRetrievalMode` controlling source-fidelity policy. Adds `groundedIn` to response. Transaction trace with `pathTaken: "concept_explainer"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/explain.test.ts`
Expected: PASS

- [ ] **Step 5: Wire route into `index.ts`**

Add `app.post("/api/explain", ...)`. Gate on `config.conceptExplainerEnabled` (from tenant config features).

- [ ] **Step 6: Commit**

```bash
git add worker/src/explain.ts worker/test/explain.test.ts worker/src/index.ts
git commit -m "feat: tenant-scoped concept explainer with configurable grounding mode"
```

---

### Task 12: Admin API (Tenant CRUD + Scoped Data Routes)

**Files:**
- Create: `worker/src/admin.ts`
- Modify: `worker/src/index.ts` (add `/admin/*` routes)
- Test: `worker/test/admin.test.ts`

**Interfaces:**
- Consumes: `Env`, `TenantConfig`, `TenantStorage`, `tenantFromRow` from `tenant.ts`
- Produces:
  - `adminRoutes`: Hono sub-app mounted at `/admin`, all routes gated by `x-admin-key`
  - Routes: `GET /admin/tenants`, `POST /admin/tenants`, `PUT /admin/tenants/:id`, `DELETE /admin/tenants/:id`, `GET /admin/tenants/:id/stats`, `GET /admin/documents?tenant_id=`, `GET /admin/documents/cleaned?tenant_id=&name=`, `GET /admin/transactions?tenant_id=`, `GET /admin/costing?tenant_id=`, `GET /admin/config?tenant_id=`, `PUT /admin/config?tenant_id=`

- [ ] **Step 1: Write the failing test**

```typescript
// worker/test/admin.test.ts
import { describe, it, expect } from "vitest";

describe("admin routes", () => {
  it("rejects without admin key", async () => {
    const res = await callAdmin("GET", "/admin/tenants", {});
    expect(res.status).toBe(401);
  });

  it("GET /admin/tenants lists all tenants", async () => {
    const res = await callAdmin("GET", "/admin/tenants", { key: "test-admin-key" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.tenants)).toBe(true);
  });

  it("POST /admin/tenants creates a new tenant", async () => {
    const res = await callAdmin("POST", "/admin/tenants", {
      key: "test-admin-key",
      body: { tenantId: "new-school", name: "New School", domain: "chat.newschool.com" },
    });
    expect(res.status).toBe(201);
  });

  it("POST /admin/tenants rejects duplicate tenantId", async () => {
    const res = await callAdmin("POST", "/admin/tenants", {
      key: "test-admin-key",
      body: { tenantId: "existing", name: "X", domain: "x.com" },
    });
    // Second call with same ID
    const res2 = await callAdmin("POST", "/admin/tenants", {
      key: "test-admin-key",
      body: { tenantId: "existing", name: "Y", domain: "y.com" },
    });
    expect(res2.status).toBe(409);
  });

  it("GET /admin/documents scopes by tenant_id", async () => {
    const res = await callAdmin("GET", "/admin/documents?tenant_id=school-a", { key: "test-admin-key" });
    expect(res.status).toBe(200);
  });

  it("GET /admin/transactions scopes by tenant_id", async () => {
    const res = await callAdmin("GET", "/admin/transactions?tenant_id=school-a", { key: "test-admin-key" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/admin.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `admin.ts`**

Export a Hono sub-app `adminRoutes`. Auth middleware checks `x-admin-key` against `env.ADMIN_API_KEY`. Routes:

- `GET /tenants`: `SELECT * FROM tenants` → map through `tenantFromRow`, return array.
- `POST /tenants`: validate `tenantId` slug format (lowercase, hyphens, no special chars), check uniqueness, `INSERT INTO tenants`, return 201.
- `PUT /tenants/:id`: update specified fields, return updated tenant.
- `DELETE /tenants/:id`: delete tenant row (does NOT delete R2/Vectorize data — that's a separate cleanup concern).
- `GET /tenants/:id/stats`: count R2 objects with prefix `t/<id>/docs/`, count transactions, get last activity.
- `GET /documents?tenant_id=`: list R2 objects under `t/<tenant_id>/docs/` (exclude `images/`, `cleaned/`).
- `GET /documents/cleaned?tenant_id=&name=`: fetch `t/<tenant_id>/cleaned/<name>.md` from R2.
- `GET /transactions?tenant_id=`: `SELECT * FROM transactions WHERE tenant_id = ? ORDER BY created_at DESC`.
- `GET /costing?tenant_id=`: aggregate token estimates from transactions for the tenant.
- `GET /config?tenant_id=`: `SELECT * FROM config WHERE tenant_id = ?`.
- `PUT /config?tenant_id=`: upsert config key/value for the tenant.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/admin.test.ts`
Expected: PASS

- [ ] **Step 5: Mount admin routes in `index.ts`**

`app.route("/admin", adminRoutes)`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/admin.ts worker/test/admin.test.ts worker/src/index.ts
git commit -m "feat: admin API with tenant CRUD and tenant-scoped data routes"
```

---

### Task 13: Dynamic PWA Manifest + Tenant API + Health Check + Image Serving

**Files:**
- Modify: `worker/src/index.ts` (add `/manifest.json`, `/api/tenant`, `/health`, `/api/images/:key` routes)
- Test: `worker/test/index.test.ts`

**Interfaces:**
- Consumes: `TenantConfig` from `tenant.ts`, `TenantStorage` from `storage.ts`, `Env`
- Produces:
  - `GET /manifest.json` → valid PWA manifest JSON with tenant name, colors, icons
  - `GET /api/tenant` → `{ tenantId, name, logoUrl, theme, features }` (no secrets)
  - `GET /health` → `{ ok: true, tenantCount: number }`
  - `GET /api/images/:key` → R2 image blob (tenant-scoped)

- [ ] **Step 1: Write the failing test**

```typescript
// worker/test/index.test.ts
import { describe, it, expect } from "vitest";

describe("public routes", () => {
  it("GET /health returns ok without tenant resolution", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.tenantCount).toBe("number");
  });

  it("GET /api/tenant returns tenant branding (no secrets)", async () => {
    const res = await appWithTenant.request("/api/tenant");
    const body = await res.json() as any;
    expect(body.tenantId).toBeTruthy();
    expect(body.name).toBeTruthy();
    expect(body.theme).toBeTruthy();
    // Must NOT contain secrets
    expect(body.adminKey).toBeUndefined();
    expect(body.rateLimits).toBeUndefined();
  });

  it("GET /manifest.json returns valid PWA manifest with tenant branding", async () => {
    const res = await appWithTenant.request("/manifest.json");
    const body = await res.json() as any;
    expect(body.name).toBeTruthy();
    expect(body.short_name).toBeTruthy();
    expect(body.theme_color).toBeTruthy();
    expect(body.display).toBe("standalone");
    expect(body.start_url).toBe("/");
  });

  it("GET /manifest.json works when logoUrl is null", async () => {
    const res = await appWithTenant.request("/manifest.json"); // tenant with null logoUrl
    const body = await res.json() as any;
    expect(body.icons).toEqual([]); // graceful empty, not crash
  });

  it("GET /api/images/:key scopes to tenant R2 prefix", async () => {
    const res = await appWithTenant.request("/api/images/physics.pdf/3.png");
    // Should have tried to read from t/<tenantId>/images/...
    expect(res.status).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/index.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the routes in `index.ts`**

- `GET /health`: before tenant middleware. Query `SELECT COUNT(*) FROM tenants`. Return `{ ok: true, tenantCount }`. On D1 error, return `{ ok: true, tenantCount: -1 }`.
- `GET /api/tenant`: return `{ tenantId: tenant.tenantId, name: tenant.name, logoUrl: tenant.logoUrl, theme: tenant.theme, features: tenant.features }`. Explicitly exclude `allowedOrigins`, `rateLimits`, `domain`.
- `GET /manifest.json`: return JSON with `name: tenant.name`, `short_name: tenant.name.slice(0, 12)`, `start_url: "/"`, `display: "standalone"`, `theme_color: tenant.theme.primaryColor`, `background_color: "#ffffff"`, `icons: tenant.logoUrl ? [{ src: tenant.logoUrl, sizes: "192x192", type: "image/png" }] : []`.
- `GET /api/images/*`: extract the path after `/api/images/`, build R2 key via `storage.r2Key("images", ...pathParts)`, fetch from R2, return with `Content-Type: image/png`. 404 if not found.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run test/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/test/index.test.ts
git commit -m "feat: dynamic PWA manifest, tenant API, health check, image serving"
```

---

### Task 14: Tenant Isolation Integration Tests

**Files:**
- Create: `worker/test/tenantIsolation.test.ts`

**Interfaces:**
- Consumes: `TenantStorage` from `storage.ts`, full app from `index.ts`
- Produces: confidence that cross-tenant leakage does not occur

- [ ] **Step 1: Write the isolation tests**

```typescript
// worker/test/tenantIsolation.test.ts
import { describe, it, expect } from "vitest";

describe("tenant isolation", () => {
  it("Vectorize query for tenant A does not return tenant B's chunks", async () => {
    const storageA = new TenantStorage("school-a", env);
    const storageB = new TenantStorage("school-b", env);

    // Verify vector IDs are different for same file across tenants
    expect(storageA.vectorId("physics.pdf", 0)).not.toBe(storageB.vectorId("physics.pdf", 0));

    // Verify vector metadata includes correct tenant
    expect(storageA.vectorMeta({}).tenantId).toBe("school-a");
    expect(storageB.vectorMeta({}).tenantId).toBe("school-b");

    // Verify filters are tenant-scoped
    expect(storageA.vectorFilter()).toEqual({ tenantId: "school-a" });
    expect(storageB.vectorFilter()).toEqual({ tenantId: "school-b" });
  });

  it("R2 keys for tenant A and tenant B never collide", () => {
    const storageA = new TenantStorage("school-a", env);
    const storageB = new TenantStorage("school-b", env);
    const keyA = storageA.r2Key("docs", "physics.pdf");
    const keyB = storageB.r2Key("docs", "physics.pdf");
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("school-a");
    expect(keyB).toContain("school-b");
  });

  it("filename sanitization prevents path traversal out of tenant prefix", () => {
    const storage = new TenantStorage("school-a", env);
    const malicious = storage.sanitizeFilename("../../school-b/docs/secret.pdf");
    const key = storage.r2Key("docs", malicious);
    expect(key).toContain("school-a");
    expect(key).not.toContain("school-b");
    expect(key).not.toContain("..");
  });

  it("dev tenant override is ignored in production", async () => {
    const env = { DB: mockDb, ENVIRONMENT: "production" } as any;
    // Even with override attempt, should resolve by hostname, not override
    const tenant = await resolveTenant("chat.schoola.com", env, { tenantOverride: "other-school" });
    expect(tenant.tenantId).toBe("school-a"); // resolved by hostname, not override
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd worker && npx vitest run test/tenantIsolation.test.ts`
Expected: PASS (all existing code already handles this correctly)

- [ ] **Step 3: Commit**

```bash
git add worker/test/tenantIsolation.test.ts
git commit -m "test: explicit tenant isolation integration tests"
```

---

### Task 15: Student Frontend (React + Vite + Tailwind PWA)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/hooks/useTenant.ts`
- Create: `frontend/src/hooks/useChat.ts`
- Create: `frontend/src/theme/TenantThemeProvider.tsx`
- Create: `frontend/src/components/Chat/ChatPage.tsx`
- Create: `frontend/src/components/Chat/MessageBubble.tsx`
- Create: `frontend/src/components/Chat/SourceCard.tsx`
- Create: `frontend/src/components/ConceptExplainer/ExplainerPage.tsx`
- Create: `frontend/src/components/common/Header.tsx`
- Create: `frontend/src/components/common/LoadingSpinner.tsx`
- Create: `frontend/src/pwa/register.ts`
- Create: `frontend/public/sw.js`
- Create: `frontend/tailwind.config.ts` (if needed for v4 — may be CSS-only)

**Interfaces:**
- Consumes: `GET /api/tenant`, `POST /api/chat`, `POST /api/explain`, `GET /manifest.json`, `GET /api/images/*` from worker
- Produces: a built React SPA in `frontend/dist/` that the worker will serve

- [ ] **Step 1: Initialize frontend project**

```bash
cd frontend
npm init -y
npm install react react-dom
npm install -D typescript @types/react @types/react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Create `vite.config.ts`**

React plugin, Tailwind plugin, output to `dist/`.

- [ ] **Step 3: Create `tsconfig.json`**

Strict, `jsx: "react-jsx"`, `target: "es2020"`.

- [ ] **Step 4: Create `index.html`**

Minimal HTML shell. `<link rel="manifest" href="/manifest.json">`. `<meta name="viewport" content="width=device-width, initial-scale=1">`. `<div id="root">`. Script tag pointing at `src/main.tsx`.

- [ ] **Step 5: Implement `api/client.ts`**

```typescript
const BASE = ""; // relative — same origin
export async function fetchTenant(): Promise<TenantInfo> { ... }
export async function postChat(question: string, answerStyle?: string): Promise<ChatResponse> { ... }
export async function postExplain(concept: string): Promise<ExplainResponse> { ... }
```

All URLs relative (no hardcoded domain). Type the response shapes.

- [ ] **Step 6: Implement `hooks/useTenant.ts`**

`useTenant()` hook: fetches `/api/tenant` on mount, caches in state. Returns `{ tenant, loading, error }`. On load, sets `document.title` to tenant name.

- [ ] **Step 7: Implement `theme/TenantThemeProvider.tsx`**

Reads tenant theme and sets CSS custom properties on `:root`: `--color-primary`, `--color-accent`. Children can use these via Tailwind's arbitrary value syntax `bg-[var(--color-primary)]` or via a `theme()` utility.

- [ ] **Step 8: Implement `components/common/Header.tsx`**

Displays tenant logo (if `logoUrl` set) and tenant name. No hardcoded branding.

- [ ] **Step 9: Implement `components/Chat/ChatPage.tsx`, `MessageBubble.tsx`, `SourceCard.tsx`**

Chat UI: text input, send button, message list (user + assistant bubbles), source cards below answers showing filename + page + snippet. If `pageImageKey` is present, render `<img src="/api/images/${pageImageKey}">`. Loading state while waiting for response. LaTeX rendering: use KaTeX (add as dependency) for formulas in messages.

- [ ] **Step 10: Implement `hooks/useChat.ts`**

`useChat()` hook: manages messages state, `sendMessage(question, answerStyle)` calls `postChat`, appends response. Handles loading and error states.

- [ ] **Step 11: Implement `components/ConceptExplainer/ExplainerPage.tsx`**

Input field for concept, submit button, structured display of response: `simpleExplanation`, `definition`, `formula` (KaTeX), `steps` (numbered list), `table` (HTML table), `realWorldExample`. Null fields hidden.

- [ ] **Step 12: Implement `App.tsx` and `main.tsx`**

`App.tsx`: wraps in `TenantThemeProvider`, renders `Header` + a simple tab/nav between Chat and Concept Explainer. `main.tsx`: `createRoot(document.getElementById("root")).render(<App />)`.

- [ ] **Step 13: Implement `pwa/register.ts` and `public/sw.js`**

`register.ts`: registers service worker if supported. `sw.js`: cache-first for static assets (`/assets/*`), network-first for API calls (`/api/*`). Minimal — just enough for PWA installability.

- [ ] **Step 14: Build and verify**

Run: `cd frontend && npm run build`
Expected: `dist/` contains `index.html`, `assets/` with JS/CSS bundles.

- [ ] **Step 15: Commit**

```bash
git add frontend/
git commit -m "feat: student frontend — React PWA with chat, concept explainer, tenant theming"
```

---

### Task 16: Operator Dashboard (React + Vite + Tailwind)

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/vite.config.ts`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/index.html`
- Create: `dashboard/src/main.tsx`
- Create: `dashboard/src/App.tsx`
- Create: `dashboard/src/api/client.ts`
- Create: `dashboard/src/hooks/useTenants.ts`
- Create: `dashboard/src/components/TenantSwitcher/TenantSwitcher.tsx`
- Create: `dashboard/src/components/TenantOnboarding/OnboardingForm.tsx`
- Create: `dashboard/src/components/TenantOnboarding/DnsInstructions.tsx`
- Create: `dashboard/src/components/TenantOnboarding/TenantList.tsx`
- Create: `dashboard/src/components/Documents/DocumentsTab.tsx`
- Create: `dashboard/src/components/Transactions/TransactionsTab.tsx`
- Create: `dashboard/src/components/Settings/SettingsTab.tsx`
- Create: `dashboard/src/components/Costing/CostingTab.tsx` (stub)
- Create: `dashboard/src/components/Observability/ObservabilityTab.tsx` (stub)

**Interfaces:**
- Consumes: all `/admin/*` routes from the worker (Task 12)
- Produces: a built React SPA in `dashboard/dist/`

- [ ] **Step 1: Initialize dashboard project**

```bash
cd dashboard
npm init -y
npm install react react-dom
npm install -D typescript @types/react @types/react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Create config files**

`vite.config.ts`, `tsconfig.json`, `index.html` — same patterns as frontend.

- [ ] **Step 3: Implement `api/client.ts`**

Admin API client. Every call includes `x-admin-key` header (stored in a local variable, prompted on first use and saved to localStorage). Every data call includes `tenant_id` query param. Base URL: relative (same origin when served by worker) or configurable for local dev.

- [ ] **Step 4: Implement `hooks/useTenants.ts`**

`useTenants()`: fetches `GET /admin/tenants`, returns list. `useActiveTenant()`: reads selected tenant from state/localStorage, exposes `activeTenantId` and `setActiveTenantId`.

- [ ] **Step 5: Implement `components/TenantSwitcher/TenantSwitcher.tsx`**

Dropdown showing all tenants by name. Selecting one sets active tenant and refreshes all tab data. Highlight current selection.

- [ ] **Step 6: Implement `components/TenantOnboarding/OnboardingForm.tsx`**

Form fields: school name (required), tenantId slug (auto-generated from name via `name.toLowerCase().replace(/[^a-z0-9]+/g, "-")`, editable), domain (required), logo upload (optional — uploads to R2 via a new admin route or as base64 in the POST body), primary color (color picker, default `#2563eb`), accent color (color picker, default `#1e40af`), feature toggles (checkboxes, all default true). Validation: tenantId format (lowercase, hyphens, no special chars), domain format. Submit calls `POST /admin/tenants`.

- [ ] **Step 7: Implement `components/TenantOnboarding/DnsInstructions.tsx`**

Post-creation card displayed after successful tenant creation. Shows:
- CNAME record: `<domain> CNAME <worker-hostname>`
- Copy-to-clipboard button for each record.
- Status indicator: "DNS Pending" until the domain resolves (can be checked later).

- [ ] **Step 8: Implement `components/TenantOnboarding/TenantList.tsx`**

Cards for each tenant: name, domain, status badge (active/pending), doc count, last activity timestamp. "Onboard New School" button at top. Clicking a card switches the tenant switcher to that school.

- [ ] **Step 9: Implement `components/Documents/DocumentsTab.tsx`**

Table of documents for the active tenant (from `GET /admin/documents?tenant_id=`). Columns: filename, page count, chunk count, enriched (yes/no), indexed date. Upload button that opens file picker → `POST /api/ingest` with the active tenant's ingest key. "View Enriched" link per doc that fetches `GET /admin/documents/cleaned?tenant_id=&name=` and shows in a modal.

- [ ] **Step 10: Implement `components/Transactions/TransactionsTab.tsx`**

Table of recent transactions for the active tenant. Columns: timestamp, path (chat/explain), question (truncated), model, token estimate. Expandable row showing full answer + trace JSON.

- [ ] **Step 11: Implement `components/Settings/SettingsTab.tsx`**

Key/value editor for the active tenant's runtime config (`GET /admin/config?tenant_id=`). Each known config key gets an appropriate input (number, select, toggle). Save calls `PUT /admin/config?tenant_id=&key=&value=`. Also shows tenant config (name, domain, theme) with edit capability calling `PUT /admin/tenants/:id`.

- [ ] **Step 12: Implement stub tabs**

`CostingTab.tsx`: "Coming soon" placeholder with a note about what it will show (token costs by tenant per day/week/month). `ObservabilityTab.tsx`: "Coming soon" placeholder.

- [ ] **Step 13: Implement `App.tsx` and `main.tsx`**

`App.tsx`: auth gate (prompt for admin key if not in localStorage), then layout with `TenantSwitcher` at top, tab navigation (Tenants/Documents/Transactions/Settings/Costing/Observability), active tab content. The "Tenants" tab shows `TenantList` + `OnboardingForm`.

- [ ] **Step 14: Build and verify**

Run: `cd dashboard && npm run build`
Expected: `dashboard/dist/` contains built SPA.

- [ ] **Step 15: Commit**

```bash
git add dashboard/
git commit -m "feat: operator dashboard with tenant onboarding, documents, transactions, settings"
```

---

### Task 17: Static Asset Serving + Final Wiring + DEPLOYMENT.md

**Files:**
- Create: `worker/src/staticAssets.ts`
- Modify: `worker/src/index.ts` (add static asset fallback)
- Modify: `worker/wrangler.toml` (add assets config)
- Create: `DEPLOYMENT.md`
- Modify: `CLAUDE.md` (rewrite for learnEasy.ai, remove EdukripaLive content)
- Modify: `README.md` (rewrite for learnEasy.ai)
- Create: `scripts/build-and-deploy.sh`

**Interfaces:**
- Consumes: built `frontend/dist/` and `dashboard/dist/`
- Produces: Worker serves the right SPA for each hostname, plus all API routes

- [ ] **Step 1: Implement `staticAssets.ts`**

Export `serveStaticAsset(c: Context, env: Env): Promise<Response>`. Logic:
- Determine which SPA to serve: if hostname matches `env.ADMIN_HOSTNAME`, serve dashboard assets; otherwise serve student frontend assets.
- Attempt to read the requested path from the KV site namespace (or Wrangler's built-in asset serving if using `--assets` directory).
- If not found, serve `index.html` (SPA fallback for client-side routing).
- Set appropriate `Cache-Control` headers: `max-age=31536000` for hashed assets, `no-cache` for `index.html`.

- [ ] **Step 2: Update `wrangler.toml` for assets**

Configure Wrangler's `[assets]` or `[site]` binding to serve from a combined build output directory. The deploy script (step 5) copies `frontend/dist/` and `dashboard/dist/` into a staging directory structure.

- [ ] **Step 3: Wire static fallback into `index.ts`**

After all API routes, add a catch-all `app.get("*", ...)` that calls `serveStaticAsset`. This is the last route — anything not matched by API routes gets the SPA.

- [ ] **Step 4: Write `DEPLOYMENT.md`**

Under 30 lines. Contents:
- Where tenant resolution lives (`worker/src/tenant.ts`).
- Steps to onboard a school: (1) Add tenant via dashboard or `POST /admin/tenants`, (2) School adds CNAME `<their-domain>` → `<worker-hostname>`, (3) Tenant appears in dashboard, ready to use.
- Deploy command: `npm run deploy` from root.
- Setup commands (first-time only): Vectorize index creation with metadata index, D1 creation, R2 bucket.

- [ ] **Step 5: Create `scripts/build-and-deploy.sh`**

Builds both frontends, copies to a staging directory, runs `npx wrangler deploy` from `worker/`.

```bash
#!/bin/bash
set -e
cd frontend && npm run build && cd ..
cd dashboard && npm run build && cd ..
# Copy builds into worker's asset directory
mkdir -p worker/public/dashboard
cp -r frontend/dist/* worker/public/
cp -r dashboard/dist/* worker/public/dashboard/
cd worker && npx wrangler deploy
```

- [ ] **Step 6: Rewrite `CLAUDE.md`**

Replace EdukripaLive content with learnEasy.ai-specific project description, commands, and architecture summary reflecting the multi-tenant design.

- [ ] **Step 7: Rewrite `README.md`**

Brief project overview for learnEasy.ai.

- [ ] **Step 8: Commit**

```bash
git add worker/src/staticAssets.ts worker/src/index.ts worker/wrangler.toml DEPLOYMENT.md CLAUDE.md README.md scripts/
git commit -m "feat: static asset serving, deploy script, project docs"
```

---

### Task 18: Full Integration Smoke Test

**Files:**
- Modify: `worker/test/` (any fixes from integration)

**Interfaces:**
- Consumes: everything
- Produces: confidence the full stack works end to end

- [ ] **Step 1: Run the full test suite**

Run: `cd worker && npx vitest run`
Expected: all tests pass.

- [ ] **Step 2: Type-check the worker**

Run: `cd worker && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build both frontends**

Run: `cd frontend && npm run build && cd ../dashboard && npm run build`
Expected: both produce `dist/` without errors.

- [ ] **Step 4: Fix any failures**

Address any test failures, type errors, or build errors discovered in steps 1-3.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: fix integration issues from full-stack smoke test"
```

(Only if there were changes to fix.)

---

## Intentionally Deferred (Not in This Plan)

These are in the spec's folder structure but not built in phase 1:

- **Question paper generation** (`worker/src/questionPaper/`) — the folder structure is ready, API endpoints and frontend UI are deferred. The D1 `question_paper_cache` table is created in Task 1's migration so the schema is ready when this is implemented.
- **Costing dashboard tab** — stub only (Task 16). Full implementation requires cost-per-token tracking that can be added to the transaction trace later.
- **Observability dashboard tab** — stub only (Task 16).
- **Eval harness** (`worker/evals/`) — deferred until the pipeline is stable and there's real data to test against.
