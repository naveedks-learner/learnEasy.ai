import { describe, it, expect } from "vitest";
import app from "../src/index";

interface Opts {
  key?: string;
  body?: unknown;
  host?: string;
}

function makeEnv(opts: { tenants?: Record<string, unknown>[]; r2Objects?: any[] } = {}) {
  const tenants = opts.tenants ?? [];
  const calls: { sql: string; args: unknown[] }[] = [];
  const DB = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first() {
          calls.push({ sql, args });
          if (sql.startsWith("SELECT tenant_id FROM tenants WHERE domain")) {
            return tenants.find((t) => t.domain === args[0] && t.tenant_id !== args[1]) ?? null;
          }
          if (sql.startsWith("SELECT tenant_id FROM tenants")) {
            return tenants.find((t) => t.tenant_id === args[0] || t.domain === args[1]) ?? null;
          }
          if (sql.startsWith("SELECT * FROM tenants")) return tenants.find((t) => t.tenant_id === args[0]) ?? null;
          if (sql.includes("COUNT(*)")) return { count: 3, last: "2026-10-19" };
          return null;
        },
        async all() {
          calls.push({ sql, args });
          if (sql.startsWith("SELECT * FROM tenants")) return { results: tenants };
          if (sql.includes("GROUP BY")) return { results: [{ provider: "openrouter", model: "m", requests: 2, tokens: 50 }] };
          return { results: [] };
        },
        async run() {
          calls.push({ sql, args });
          if (sql.startsWith("UPDATE tenants")) {
            const t = tenants.find((x) => x.tenant_id === args[args.length - 1]);
            if (t) {
              const hasName = sql.includes("name = ?");
              if (hasName) t.name = args[0];
              if (sql.includes("domain = ?")) t.domain = args[hasName ? 1 : 0];
            }
          }
          if (sql.startsWith("DELETE FROM tenants")) {
            const i = tenants.findIndex((x) => x.tenant_id === args[0]);
            if (i >= 0) tenants.splice(i, 1);
          }
          if (sql.startsWith("INSERT INTO tenants")) {
            tenants.push({ tenant_id: args[0], name: args[1], domain: args[2] });
          }
          return { success: true, meta: { changes: sql.startsWith("DELETE FROM") ? 2 : 0 } };
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) {
      for (const st of stmts) await st.run();
      return [];
    },
  };
  const listCalls: any[] = [];
  const deletedKeys: string[] = [];
  const PDF_BUCKET = {
    async list(o: any) {
      listCalls.push(o);
      return { objects: (opts.r2Objects ?? []).filter((x: any) => x.key.startsWith(o.prefix)), truncated: false };
    },
    async get(key: string) {
      return key === "t/school-a/cleaned/a.pdf.md" ? { text: async () => "# cleaned" } : null;
    },
    async delete(keys: string | string[]) {
      deletedKeys.push(...(Array.isArray(keys) ? keys : [keys]));
    },
  };
  return {
    env: { DB, PDF_BUCKET, ADMIN_API_KEY: "test-admin-key", ADMIN_HOSTNAME: "", ENVIRONMENT: "production" } as any,
    calls,
    listCalls,
    deletedKeys,
  };
}

async function callAdmin(method: string, path: string, o: Opts, env: any) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.key) headers["x-admin-key"] = o.key;
  return app.fetch(
    new Request(`https://${o.host ?? "admin.example.com"}${path}`, {
      method,
      headers,
      body: o.body ? JSON.stringify(o.body) : undefined,
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
}

describe("admin routes", () => {
  it("rejects without admin key", async () => {
    const { env } = makeEnv();
    expect((await callAdmin("GET", "/admin/tenants", {}, env)).status).toBe(401);
  });

  it("rejects a wrong admin key", async () => {
    const { env } = makeEnv();
    expect((await callAdmin("GET", "/admin/tenants", { key: "nope" }, env)).status).toBe(401);
  });

  it("DELETE /admin/tenants/:id deletes, and 404s for unknown", async () => {
    const { env, calls } = makeEnv({ tenants: [{ tenant_id: "a", name: "A", domain: "a.com" }] });
    expect((await callAdmin("DELETE", "/admin/tenants/zzz", { key: "test-admin-key" }, env)).status).toBe(404);
    const res = await callAdmin("DELETE", "/admin/tenants/a", { key: "test-admin-key" }, env);
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.sql.startsWith("DELETE FROM config"))).toBe(true);
    expect(calls.some((c) => c.sql.startsWith("DELETE FROM tenants"))).toBe(true);
  });

  it("DELETE /admin/tenants/:id/purge-data erases tenant data but keeps the tenant row", async () => {
    const { env, calls, deletedKeys } = makeEnv({
      tenants: [{ tenant_id: "a", name: "A", domain: "a.com" }],
      r2Objects: [
        { key: "t/a/docs/x.pdf", size: 1, uploaded: "x" },
        { key: "t/a/images/x.pdf/1.png", size: 1, uploaded: "x" },
        { key: "t/a/cleaned/x.pdf.md", size: 1, uploaded: "x" },
        { key: "t/ab/docs/other.pdf", size: 1, uploaded: "x" },
      ],
    });
    expect((await callAdmin("DELETE", "/admin/tenants/zzz/purge-data", { key: "test-admin-key" }, env)).status).toBe(404);
    expect((await callAdmin("DELETE", "/admin/tenants/a/purge-data", {}, env)).status).toBe(401);
    const res = await callAdmin("DELETE", "/admin/tenants/a/purge-data", { key: "test-admin-key" }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      deleted: { transactions: 2, config: 2, rateLimits: 2, r2Objects: 3, vectorIds: 0 },
    });
    for (const table of ["transactions", "config", "rate_limits", "question_paper_cache"]) {
      expect(calls.some((c) => c.sql.startsWith(`DELETE FROM ${table}`) && c.args[0] === "a")).toBe(true);
    }
    expect(calls.some((c) => c.sql.startsWith("DELETE FROM tenants"))).toBe(false);
    expect(deletedKeys.sort()).toEqual(["t/a/cleaned/x.pdf.md", "t/a/docs/x.pdf", "t/a/images/x.pdf/1.png"]);
  });

  it("PUT /admin/config validates dataRetentionDays", async () => {
    const { env } = makeEnv();
    for (const value of ["0", "-5", "1.5", "abc"]) {
      const res = await callAdmin(
        "PUT",
        "/admin/config?tenant_id=school-a",
        { key: "test-admin-key", body: { key: "dataRetentionDays", value } },
        env,
      );
      expect(res.status).toBe(400);
    }
    const ok = await callAdmin(
      "PUT",
      "/admin/config?tenant_id=school-a",
      { key: "test-admin-key", body: { key: "dataRetentionDays", value: 30 } },
      env,
    );
    expect(ok.status).toBe(200);
  });

  it("GET /privacy serves HTML without a tenant", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(new Request("https://unknown.example.com/privacy"), env, {
      waitUntil() {},
      passThroughOnException() {},
    } as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Privacy Policy");
  });

  it("PUT /admin/tenants/:id updates name and domain", async () => {
    const { env } = makeEnv({ tenants: [{ tenant_id: "a", name: "A", domain: "a.com" }] });
    const res = await callAdmin(
      "PUT",
      "/admin/tenants/a",
      { key: "test-admin-key", body: { name: "A2", domain: "a2.com" } },
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).tenant).toMatchObject({ name: "A2", domain: "a2.com" });
  });

  it("PUT /admin/tenants/:id 409s when domain belongs to another tenant", async () => {
    const { env } = makeEnv({
      tenants: [
        { tenant_id: "a", name: "A", domain: "a.com" },
        { tenant_id: "b", name: "B", domain: "b.com" },
      ],
    });
    const res = await callAdmin("PUT", "/admin/tenants/a", { key: "test-admin-key", body: { domain: "b.com" } }, env);
    expect(res.status).toBe(409);
  });

  it("PUT /admin/config rejects invalid typed values", async () => {
    const { env } = makeEnv();
    for (const body of [
      { key: "topK", value: "abc" },
      { key: "topK", value: -1 },
      { key: "llmProvider", value: "nope" },
      { key: "jevEnabled", value: "maybe" },
    ]) {
      const res = await callAdmin("PUT", "/admin/config?tenant_id=school-a", { key: "test-admin-key", body }, env);
      expect(res.status).toBe(400);
    }
  });

  it("GET /admin/config returns config", async () => {
    const { env } = makeEnv();
    const res = await callAdmin("GET", "/admin/config?tenant_id=school-a", { key: "test-admin-key" }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).config.topK).toBe(5);
  });

  it("GET /admin/documents/cleaned 404s when missing", async () => {
    const { env } = makeEnv();
    const res = await callAdmin(
      "GET",
      "/admin/documents/cleaned?tenant_id=school-a&name=missing.pdf",
      { key: "test-admin-key" },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("rejects wrong host when ADMIN_HOSTNAME is set", async () => {
    const { env } = makeEnv();
    env.ADMIN_HOSTNAME = "admin.example.com";
    const res = await callAdmin("GET", "/admin/tenants", { key: "test-admin-key", host: "evil.com" }, env);
    expect(res.status).toBe(404);
  });

  it("GET /admin/tenants lists all tenants", async () => {
    const { env } = makeEnv({ tenants: [{ tenant_id: "a", name: "A", domain: "a.com" }] });
    const res = await callAdmin("GET", "/admin/tenants", { key: "test-admin-key" }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tenants[0].tenantId).toBe("a");
  });

  it("POST /admin/tenants creates a tenant, then 409 on duplicate", async () => {
    const { env } = makeEnv();
    const body = { tenantId: "new-school", name: "New School", domain: "chat.newschool.com" };
    expect((await callAdmin("POST", "/admin/tenants", { key: "test-admin-key", body }, env)).status).toBe(201);
    expect((await callAdmin("POST", "/admin/tenants", { key: "test-admin-key", body }, env)).status).toBe(409);
  });

  it("POST /admin/tenants rejects bad slug", async () => {
    const { env } = makeEnv();
    const res = await callAdmin(
      "POST",
      "/admin/tenants",
      { key: "test-admin-key", body: { tenantId: "Bad_ID", name: "x", domain: "x.com" } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("PUT /admin/tenants/:id 404s for unknown tenant", async () => {
    const { env } = makeEnv();
    const res = await callAdmin("PUT", "/admin/tenants/nope", { key: "test-admin-key", body: { name: "Z" } }, env);
    expect(res.status).toBe(404);
  });

  it("GET /admin/documents scopes to tenant prefix and excludes images/cleaned", async () => {
    const { env, listCalls } = makeEnv({
      r2Objects: [
        { key: "t/school-a/docs/a.pdf", size: 1, uploaded: "x", customMetadata: { chunkCount: "4", enriched: "true" } },
        { key: "t/school-a/images/a.pdf/1.png", size: 1, uploaded: "x" },
        { key: "t/school-a/cleaned/a.md", size: 1, uploaded: "x" },
      ],
    });
    const res = await callAdmin("GET", "/admin/documents?tenant_id=school-a", { key: "test-admin-key" }, env);
    const body = (await res.json()) as any;
    expect(listCalls[0].prefix).toBe("t/school-a/docs/");
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({ name: "a.pdf", chunkCount: 4, enriched: true });
  });

  it("GET /admin/documents/cleaned returns text", async () => {
    const { env } = makeEnv();
    const res = await callAdmin(
      "GET",
      "/admin/documents/cleaned?tenant_id=school-a&name=a.pdf",
      { key: "test-admin-key" },
      env,
    );
    expect(((await res.json()) as any).text).toBe("# cleaned");
  });

  it("GET /admin/transactions requires and uses tenant_id", async () => {
    const { env, calls } = makeEnv();
    expect((await callAdmin("GET", "/admin/transactions", { key: "test-admin-key" }, env)).status).toBe(400);
    const res = await callAdmin("GET", "/admin/transactions?tenant_id=school-a", { key: "test-admin-key" }, env);
    expect(res.status).toBe(200);
    expect(calls.at(-1)!.args[0]).toBe("school-a");
  });

  it("GET /admin/costing aggregates tokens", async () => {
    const { env } = makeEnv();
    const res = await callAdmin("GET", "/admin/costing?tenant_id=school-a", { key: "test-admin-key" }, env);
    expect(await res.json()).toMatchObject({ totalRequests: 2, totalTokens: 50 });
  });

  it("GET /admin/transactions supports since filter", async () => {
    const { env, calls } = makeEnv();
    const res = await callAdmin(
      "GET",
      "/admin/transactions?tenant_id=school-a&since=2026-10-01T00:00:00Z",
      { key: "test-admin-key" },
      env,
    );
    expect(res.status).toBe(200);
    const lastCall = calls.at(-1)!;
    expect(lastCall.sql).toContain("created_at >= ?");
    expect(lastCall.args[1]).toBe("2026-10-01T00:00:00Z");
  });

  it("GET /admin/costing supports since filter", async () => {
    const { env, calls } = makeEnv();
    const res = await callAdmin(
      "GET",
      "/admin/costing?tenant_id=school-a&since=2026-10-15T00:00:00Z",
      { key: "test-admin-key" },
      env,
    );
    expect(res.status).toBe(200);
    const costingCall = calls.find((c) => c.sql.includes("GROUP BY"));
    expect(costingCall!.sql).toContain("created_at >= ?");
    expect(costingCall!.args[1]).toBe("2026-10-15T00:00:00Z");
  });

  it("GET /admin/documents/chunks returns re-chunked text", async () => {
    const { env } = makeEnv();
    // The mock PDF_BUCKET.get returns "# cleaned" for "t/school-a/cleaned/a.pdf.md"
    const res = await callAdmin(
      "GET",
      "/admin/documents/chunks?tenant_id=school-a&name=a.pdf",
      { key: "test-admin-key" },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("a.pdf");
    expect(Array.isArray(body.chunks)).toBe(true);
    expect(body.chunks.length).toBeGreaterThan(0);
    expect(body.chunks[0]).toHaveProperty("text");
    expect(body.chunks[0]).toHaveProperty("startPage");
    expect(body.chunks[0]).toHaveProperty("chunkIndex");
  });

  it("GET /admin/documents/chunks 404s for missing document", async () => {
    const { env } = makeEnv();
    const res = await callAdmin(
      "GET",
      "/admin/documents/chunks?tenant_id=school-a&name=missing.pdf",
      { key: "test-admin-key" },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("PUT /admin/config rejects unknown keys and saves valid ones", async () => {
    const { env, calls } = makeEnv();
    const bad = await callAdmin(
      "PUT",
      "/admin/config?tenant_id=school-a",
      { key: "test-admin-key", body: { key: "bogus", value: "1" } },
      env,
    );
    expect(bad.status).toBe(400);
    const res = await callAdmin(
      "PUT",
      "/admin/config?tenant_id=school-a",
      { key: "test-admin-key", body: { key: "topK", value: 7 } },
      env,
    );
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.sql.startsWith("INSERT INTO config") && c.args[2] === "7")).toBe(true);
  });
});
