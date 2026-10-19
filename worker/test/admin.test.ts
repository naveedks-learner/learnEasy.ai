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
          if (sql.startsWith("INSERT INTO tenants")) {
            tenants.push({ tenant_id: args[0], name: args[1], domain: args[2] });
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
  const listCalls: any[] = [];
  const PDF_BUCKET = {
    async list(o: any) {
      listCalls.push(o);
      return { objects: opts.r2Objects ?? [], truncated: false };
    },
    async get(key: string) {
      return key === "t/school-a/cleaned/a.pdf.md" ? { text: async () => "# cleaned" } : null;
    },
  };
  return {
    env: { DB, PDF_BUCKET, ADMIN_API_KEY: "test-admin-key", ADMIN_HOSTNAME: "", ENVIRONMENT: "production" } as any,
    calls,
    listCalls,
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
        { key: "t/school-a/docs/images/a.pdf/1.png", size: 1, uploaded: "x" },
        { key: "t/school-a/docs/cleaned/a.md", size: 1, uploaded: "x" },
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
