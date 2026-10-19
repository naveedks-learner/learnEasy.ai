import { Hono } from "hono";
import type { Env } from "./env";
import { buildCorsHeaders } from "./cors";
import { tenantFromRow } from "./tenant";
import { TenantStorage } from "./storage";
import { DEFAULTS, loadConfig, saveConfigField } from "./config";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CONFIG_ENUMS: Record<string, readonly string[]> = {
  webSearchMode: ["auto", "rag_only", "web_only"],
  llmProvider: ["openrouter", "workers-ai"],
  explainRetrievalMode: ["rag_fallback", "rag_plus_llm"],
  answerStyle: ["auto", "short", "detailed"],
};

function validateConfigValue(key: keyof typeof DEFAULTS, value: string): boolean {
  if (key === "questionPaperModelSlug") return true;
  const def = DEFAULTS[key];
  if (typeof def === "number") {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return false;
    return key === "topK" ? Number.isInteger(n) && n >= 0 : true;
  }
  if (typeof def === "boolean") return value === "true" || value === "false";
  if (CONFIG_ENUMS[key]) return CONFIG_ENUMS[key].includes(value);
  return value.trim() !== "";
}

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use("*", async (c, next) => {
  const adminHost = c.env.ADMIN_HOSTNAME;
  const cors = buildCorsHeaders(c.req.header("Origin") ?? "", [], adminHost ?? "");
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (adminHost && new URL(c.req.url).host !== adminHost) return c.json({ error: "Not found" }, 404);
  const key = c.req.header("x-admin-key");
  if (!c.env.ADMIN_API_KEY || key !== c.env.ADMIN_API_KEY) return c.json({ error: "Unauthorized" }, 401);
  await next();
  for (const [k, v] of Object.entries(cors)) c.res.headers.set(k, v);
});

adminRoutes.get("/tenants", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM tenants").all<Record<string, unknown>>();
  return c.json({ tenants: (results ?? []).map(tenantFromRow) });
});

adminRoutes.post("/tenants", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const tenantId = body?.tenantId;
  const name = body?.name;
  const domain = body?.domain;
  if (typeof tenantId !== "string" || !SLUG_RE.test(tenantId)) {
    return c.json({ error: "tenantId must be a lowercase slug (a-z, 0-9, hyphens)" }, 400);
  }
  if (typeof name !== "string" || !name || typeof domain !== "string" || !domain) {
    return c.json({ error: "name and domain are required" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE tenant_id = ? OR domain = ?")
    .bind(tenantId, domain)
    .first();
  if (existing) return c.json({ error: "Tenant already exists" }, 409);
  await c.env.DB.prepare(
    "INSERT INTO tenants (tenant_id, name, domain, logo_url, theme_json, allowed_origins_json, features_json, rate_limits_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      tenantId,
      name,
      domain,
      typeof body?.logoUrl === "string" ? body.logoUrl : "",
      JSON.stringify(body?.theme ?? {}),
      JSON.stringify(body?.allowedOrigins ?? []),
      JSON.stringify(body?.features ?? {}),
      JSON.stringify(body?.rateLimits ?? {}),
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM tenants WHERE tenant_id = ?")
    .bind(tenantId)
    .first<Record<string, unknown>>();
  return c.json({ tenant: row ? tenantFromRow(row) : { tenantId, name, domain } }, 201);
});

adminRoutes.put("/tenants/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);
  const columns: Record<string, string> = {
    name: "name",
    domain: "domain",
    logoUrl: "logo_url",
    theme: "theme_json",
    allowedOrigins: "allowed_origins_json",
    features: "features_json",
    rateLimits: "rate_limits_json",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [field, col] of Object.entries(columns)) {
    if (!(field in body)) continue;
    const v = body[field];
    const isJson = col.endsWith("_json");
    if (!isJson && typeof v !== "string") return c.json({ error: `${field} must be a string` }, 400);
    sets.push(`${col} = ?`);
    values.push(isJson ? JSON.stringify(v) : v);
  }
  const existing = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE tenant_id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Tenant not found" }, 404);
  if (typeof body.domain === "string") {
    const clash = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE domain = ? AND tenant_id != ?")
      .bind(body.domain, id)
      .first();
    if (clash) return c.json({ error: "Domain already in use" }, 409);
  }
  if (sets.length > 0) {
    try {
      await c.env.DB.prepare(`UPDATE tenants SET ${sets.join(", ")}, updated_at = datetime('now') WHERE tenant_id = ?`)
        .bind(...values, id)
        .run();
    } catch (err) {
      if (err instanceof Error && /UNIQUE|constraint/i.test(err.message)) {
        return c.json({ error: "Domain already in use" }, 409);
      }
      throw err;
    }
  }
  const row = await c.env.DB.prepare("SELECT * FROM tenants WHERE tenant_id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json({ tenant: tenantFromRow(row!) });
});

adminRoutes.delete("/tenants/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE tenant_id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Tenant not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM rate_limits WHERE tenant_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM question_paper_cache WHERE tenant_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM config WHERE tenant_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM transactions WHERE tenant_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM tenants WHERE tenant_id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

adminRoutes.get("/tenants/:id/stats", async (c) => {
  const id = c.req.param("id");
  const storage = new TenantStorage(id, c.env);
  let documentCount = 0;
  let cursor: string | undefined;
  do {
    const listed = await c.env.PDF_BUCKET.list({ prefix: storage.r2Key("docs", ""), cursor });
    documentCount += listed.objects.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  const stats = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count, MAX(created_at) AS last FROM transactions WHERE tenant_id = ?",
  )
    .bind(id)
    .first<{ count: number; last: string | null }>();
  return c.json({
    tenantId: id,
    documentCount,
    transactionCount: stats?.count ?? 0,
    lastActivity: stats?.last ?? null,
  });
});

adminRoutes.get("/documents", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const storage = new TenantStorage(id, c.env);
  const prefix = storage.r2Key("docs", "");
  const documents: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const listed = await c.env.PDF_BUCKET.list({ prefix, cursor, include: ["customMetadata"] });
    for (const obj of listed.objects) {
      const name = obj.key.slice(prefix.length);
      if (!name) continue;
      const meta = obj.customMetadata ?? {};
      documents.push({
        name,
        size: obj.size,
        uploaded: obj.uploaded,
        chunkCount: meta.chunkCount !== undefined ? Number(meta.chunkCount) : null,
        pageCount: meta.pageCount !== undefined ? Number(meta.pageCount) : null,
        indexedAt: meta.indexedAt ?? null,
        enriched: meta.enriched === "true",
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return c.json({ documents });
});

adminRoutes.get("/documents/cleaned", async (c) => {
  const id = c.req.query("tenant_id");
  const name = c.req.query("name");
  if (!id || !name) return c.json({ error: "tenant_id and name required" }, 400);
  const storage = new TenantStorage(id, c.env);
  const safe = storage.sanitizeFilename(name);
  const obj = safe ? await c.env.PDF_BUCKET.get(storage.r2Key("cleaned", `${safe}.md`)) : null;
  if (!obj) return c.json({ error: "Not found" }, 404);
  return c.json({ name: safe, text: await obj.text() });
});

adminRoutes.get("/transactions", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM transactions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(id, limit)
    .all();
  return c.json({ transactions: results ?? [] });
});

adminRoutes.get("/costing", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const { results } = await c.env.DB.prepare(
    "SELECT provider, model, COUNT(*) AS requests, COALESCE(SUM(token_estimate), 0) AS tokens FROM transactions WHERE tenant_id = ? GROUP BY provider, model",
  )
    .bind(id)
    .all<{ provider: string | null; model: string | null; requests: number; tokens: number }>();
  const breakdown = results ?? [];
  return c.json({
    totalRequests: breakdown.reduce((s, r) => s + r.requests, 0),
    totalTokens: breakdown.reduce((s, r) => s + r.tokens, 0),
    breakdown,
  });
});

adminRoutes.get("/config", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  return c.json({ config: await loadConfig(id, c.env.DB) });
});

adminRoutes.put("/config", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const body = (await c.req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!body || typeof body.key !== "string" || !Object.prototype.hasOwnProperty.call(DEFAULTS, body.key)) {
    return c.json({ error: "Unknown config key" }, 400);
  }
  if (body.value === undefined || body.value === null || typeof body.value === "object") {
    return c.json({ error: "value must be a string, number or boolean" }, 400);
  }
  const value = String(body.value);
  if (!validateConfigValue(body.key as keyof typeof DEFAULTS, value)) {
    return c.json({ error: `Invalid value for ${body.key}` }, 400);
  }
  await saveConfigField(id, c.env.DB, body.key, value);
  return c.json({ config: await loadConfig(id, c.env.DB) });
});
