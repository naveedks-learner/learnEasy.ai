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
