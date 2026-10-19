import { describe, it, expect } from "vitest";
import { TenantStorage } from "../src/storage";
import { resolveTenant } from "../src/tenant";

const env = {} as any;

const ROWS: Record<string, Record<string, unknown>> = {
  "chat.schoola.com": { tenant_id: "school-a", name: "School A", domain: "chat.schoola.com" },
  "chat.schoolb.com": { tenant_id: "school-b", name: "School B", domain: "chat.schoolb.com" },
};

function mockDb() {
  return {
    prepare: (sql: string) => ({
      bind: (arg: string) => ({
        first: async () =>
          sql.includes("tenant_id = ?")
            ? Object.values(ROWS).find((r) => r.tenant_id === arg) ?? null
            : ROWS[arg] ?? null,
      }),
    }),
  };
}

describe("tenant isolation", () => {
  it("vector IDs, metadata and filters are tenant-scoped", () => {
    const a = new TenantStorage("school-a", env);
    const b = new TenantStorage("school-b", env);
    expect(a.vectorId("physics.pdf", 0)).not.toBe(b.vectorId("physics.pdf", 0));
    expect(a.vectorMeta({}).tenantId).toBe("school-a");
    expect(b.vectorMeta({}).tenantId).toBe("school-b");
    expect(a.vectorFilter()).toEqual({ tenantId: "school-a" });
    expect(b.vectorFilter()).toEqual({ tenantId: "school-b" });
  });

  it("R2 keys for tenant A and tenant B never collide", () => {
    const keyA = new TenantStorage("school-a", env).r2Key("docs", "physics.pdf");
    const keyB = new TenantStorage("school-b", env).r2Key("docs", "physics.pdf");
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("school-a");
    expect(keyB).toContain("school-b");
  });

  it("filename sanitization prevents path traversal out of tenant prefix", () => {
    const storage = new TenantStorage("school-a", env);
    const malicious = storage.sanitizeFilename("../../school-b/docs/secret.pdf");
    const key = storage.r2Key("docs", malicious);
    expect(key.startsWith("t/school-a/docs/")).toBe(true);
    // Separators are stripped, so the whole name collapses into a single path segment
    // (the literal text "school-b" may survive, but it can no longer act as a path component).
    expect(malicious).not.toMatch(/[\/\\]/);
    expect(key.split("/")).toEqual(["t", "school-a", "docs", malicious]);
    expect(key).not.toContain("..");
  });

  it("dev tenant override is ignored in production", async () => {
    const e = { DB: mockDb(), ENVIRONMENT: "production" } as any;
    const tenant = await resolveTenant("chat.schoola.com", e, { tenantOverride: "school-b" });
    expect(tenant.tenantId).toBe("school-a");
  });

  it("dev tenant override is honoured in development", async () => {
    const e = { DB: mockDb(), ENVIRONMENT: "development" } as any;
    const tenant = await resolveTenant("chat.schoola.com", e, { tenantOverride: "school-b" });
    expect(tenant.tenantId).toBe("school-b");
  });
});
