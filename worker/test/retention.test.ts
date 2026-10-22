import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanupExpiredData } from "../src/retention";

interface Call {
  sql: string;
  args: unknown[];
}

function makeDb(opts: {
  tenants: string[];
  retention?: Record<string, string>;
  changes?: (call: Call) => number;
  failFor?: string;
}) {
  const calls: Call[] = [];
  const DB = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async all() {
          calls.push({ sql, args });
          if (sql.startsWith("SELECT tenant_id FROM tenants")) {
            return { results: opts.tenants.map((t) => ({ tenant_id: t })) };
          }
          if (sql.startsWith("SELECT key, value FROM config")) {
            const v = opts.retention?.[args[0] as string];
            return { results: v ? [{ key: "dataRetentionDays", value: v }] : [] };
          }
          return { results: [] };
        },
        async run() {
          const call = { sql, args };
          calls.push(call);
          if (opts.failFor && args[0] === opts.failFor && sql.startsWith("DELETE FROM transactions")) {
            throw new Error("D1 down");
          }
          return { success: true, meta: { changes: opts.changes ? opts.changes(call) : 0 } };
        },
      };
      return stmt;
    },
  };
  return { env: { DB } as any, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("cleanupExpiredData", () => {
  it("deletes transactions using the default 90-day retention", async () => {
    const { env, calls } = makeDb({ tenants: ["a"] });
    await cleanupExpiredData(env);
    const del = calls.find((c) => c.sql.startsWith("DELETE FROM transactions"))!;
    expect(del.sql).toContain("created_at < ?");
    expect(del.args[0]).toBe("a");
    expect(typeof del.args[1]).toBe("string");
  });

  it("uses each tenant's own dataRetentionDays with parameterized cutoff dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    try {
      const { env, calls } = makeDb({ tenants: ["a", "b"], retention: { a: "30", b: "365" } });
      await cleanupExpiredData(env);
      const dels = calls.filter((c) => c.sql.startsWith("DELETE FROM transactions"));
      expect(dels[0].args[0]).toBe("a");
      expect(dels[0].args[1]).toBe(new Date(Date.now() - 30 * 86_400_000).toISOString());
      expect(dels[1].args[0]).toBe("b");
      expect(dels[1].args[1]).toBe(new Date(Date.now() - 365 * 86_400_000).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes rate_limits older than one hour using an ISO minute cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:30:45.000Z"));
    try {
      const { env, calls } = makeDb({ tenants: ["a"] });
      await cleanupExpiredData(env);
      const del = calls.find((c) => c.sql.startsWith("DELETE FROM rate_limits"))!;
      expect(del.sql).toContain("window < ?");
      expect(del.args).toEqual(["a", "2026-10-20T11:30"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns correct counts", async () => {
    const { env } = makeDb({
      tenants: ["a", "b"],
      changes: (c) => (c.sql.startsWith("DELETE FROM transactions") ? 5 : 2),
    });
    expect(await cleanupExpiredData(env)).toEqual({
      tenantsProcessed: 2,
      transactionsDeleted: 10,
      rateLimitsDeleted: 4,
    });
  });

  it("logs and continues to the next tenant when D1 errors (fail-open)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = makeDb({ tenants: ["a", "b"], failFor: "a", changes: () => 3 });
    const res = await cleanupExpiredData(env);
    expect(err).toHaveBeenCalled();
    expect(res.tenantsProcessed).toBe(1);
    expect(res.transactionsDeleted).toBe(3);
  });

  it("returns an empty summary if listing tenants fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      DB: {
        prepare: () => ({
          all: async () => {
            throw new Error("boom");
          },
        }),
      },
    } as any;
    expect(await cleanupExpiredData(env)).toEqual({
      tenantsProcessed: 0,
      transactionsDeleted: 0,
      rateLimitsDeleted: 0,
    });
  });
});
