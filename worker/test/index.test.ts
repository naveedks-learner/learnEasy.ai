import { describe, it, expect } from "vitest";
import app from "../src/index";

function makeEnv(opts: { logo?: string | null; dbFails?: boolean; r2?: Record<string, string> } = {}) {
  const row = {
    tenant_id: "acme",
    name: "Acme International School",
    domain: "acme.test",
    logo_url: opts.logo === undefined ? null : opts.logo,
    theme_json: JSON.stringify({ primaryColor: "#123456" }),
  };
  const r2Gets: string[] = [];
  return {
    r2Gets,
    env: {
      ENVIRONMENT: "production",
      DB: {
        prepare(sql: string) {
          return {
            bind: () => ({ first: async () => (sql.includes("FROM tenants WHERE domain") ? row : null) }),
            first: async () => {
              if (opts.dbFails) throw new Error("d1 down");
              return { count: 4 };
            },
          };
        },
      },
      PDF_BUCKET: {
        async get(key: string) {
          r2Gets.push(key);
          const v = opts.r2?.[key];
          return v === undefined ? null : { body: v };
        },
      },
    } as any,
  };
}

describe("public routes", () => {
  it("GET /health returns ok without tenant resolution", async () => {
    const { env } = makeEnv();
    const res = await app.request("http://nowhere.test/health", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.tenantCount).toBe(4);
  });

  it("GET /health fails open with tenantCount -1", async () => {
    const { env } = makeEnv({ dbFails: true });
    const res = await app.request("http://nowhere.test/health", {}, env);
    const body = (await res.json()) as any;
    expect(body).toEqual({ ok: true, tenantCount: -1 });
  });

  it("GET /api/tenant returns tenant branding (no secrets)", async () => {
    const { env } = makeEnv();
    const res = await app.request("http://acme.test/api/tenant", {}, env);
    const body = (await res.json()) as any;
    expect(body.tenantId).toBe("acme");
    expect(body.name).toBeTruthy();
    expect(body.theme.primaryColor).toBe("#123456");
    expect(body.features).toBeTruthy();
    expect(body.adminKey).toBeUndefined();
    expect(body.rateLimits).toBeUndefined();
    expect(body.allowedOrigins).toBeUndefined();
    expect(body.domain).toBeUndefined();
  });

  it("GET /manifest.json returns valid PWA manifest with tenant branding", async () => {
    const { env } = makeEnv({ logo: "https://cdn.test/logo.png" });
    const res = await app.request("http://acme.test/manifest.json", {}, env);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Acme International School");
    expect(body.short_name).toBe("Acme Interna");
    expect(body.theme_color).toBe("#123456");
    expect(body.display).toBe("standalone");
    expect(body.start_url).toBe("/");
    expect(body.icons).toEqual([{ src: "https://cdn.test/logo.png", sizes: "192x192", type: "image/png" }]);
  });

  it("GET /manifest.json works when logoUrl is null", async () => {
    const { env } = makeEnv({ logo: null });
    const res = await app.request("http://acme.test/manifest.json", {}, env);
    const body = (await res.json()) as any;
    expect(body.icons).toEqual([]);
  });

  it("GET /api/images/* scopes to tenant R2 prefix", async () => {
    const { env, r2Gets } = makeEnv({ r2: { "t/acme/images/physics.pdf/3.png": "PNGDATA" } });
    const res = await app.request("http://acme.test/api/images/physics.pdf/3.png", {}, env);
    expect(r2Gets).toEqual(["t/acme/images/physics.pdf/3.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(await res.text()).toBe("PNGDATA");
  });

  it("GET /api/images/* returns 404 when missing and blocks traversal", async () => {
    const { env, r2Gets } = makeEnv();
    const res = await app.request("http://acme.test/api/images/x/y.png", {}, env);
    expect(res.status).toBe(404);
    await app.request("http://acme.test/api/images/%2E%2E/other/secret.png", {}, env);
    expect(r2Gets.every((k) => k.startsWith("t/acme/images/") && !k.includes(".."))).toBe(true);
  });
});
