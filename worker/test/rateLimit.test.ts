import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../src/rateLimit";

describe("checkRateLimit", () => {
  it("allows request when under limit", async () => {
    const mockDb = mockD1WithCount(5);
    const result = await checkRateLimit("tenant-a", 60, mockDb as any);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(54); // 60 - 5 - 1
  });

  it("allows first request when no row exists", async () => {
    const mockDb = { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}) }) }) };
    const result = await checkRateLimit("tenant-a", 60, mockDb as any);
    expect(result).toEqual({ allowed: true, remaining: 59 });
  });

  it("blocks request when at limit", async () => {
    const mockDb = mockD1WithCount(60);
    const result = await checkRateLimit("tenant-a", 60, mockDb as any);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
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
        first: async () => (sql.includes("SELECT") ? { count } : null),
        run: async () => ({}),
      }),
    }),
  };
}
