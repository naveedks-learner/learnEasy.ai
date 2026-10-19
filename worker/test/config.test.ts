import { describe, it, expect } from "vitest";
import { loadConfig, saveConfigField, DEFAULTS } from "../src/config";

function dbWithRows(rows: { key: string; value: string | null }[]) {
  return { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) };
}

describe("loadConfig", () => {
  it("returns defaults when D1 has no rows for tenant", async () => {
    const cfg = await loadConfig("tenant-x", dbWithRows([]) as any);
    expect(cfg.topK).toBe(DEFAULTS.topK);
    expect(cfg.llmProvider).toBe("openrouter");
    expect(cfg.guardrailEnabled).toBe(true);
  });

  it("overrides defaults with D1 values", async () => {
    const rows = [{ key: "topK", value: "10" }, { key: "llmProvider", value: "workers-ai" }];
    const cfg = await loadConfig("tenant-x", dbWithRows(rows) as any);
    expect(cfg.topK).toBe(10);
    expect(cfg.llmProvider).toBe("workers-ai");
  });

  it("coerces booleans and nullable strings", async () => {
    const rows = [
      { key: "guardrailEnabled", value: "false" },
      { key: "jevEnabled", value: "0" },
      { key: "questionPaperModelSlug", value: "x/y" },
    ];
    const cfg = await loadConfig("t", dbWithRows(rows) as any);
    expect(cfg.guardrailEnabled).toBe(false);
    expect(cfg.jevEnabled).toBe(false);
    expect(cfg.questionPaperModelSlug).toBe("x/y");
  });

  it("ignores invalid values and unknown keys", async () => {
    const rows = [
      { key: "topK", value: "abc" },
      { key: "llmProvider", value: "bogus" },
      { key: "nope", value: "1" },
    ];
    const cfg = await loadConfig("t", dbWithRows(rows) as any);
    expect(cfg.topK).toBe(DEFAULTS.topK);
    expect(cfg.llmProvider).toBe("openrouter");
    expect((cfg as any).nope).toBeUndefined();
  });

  it("returns defaults when D1 throws (fail-open)", async () => {
    const mockDb = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error("D1 down"); } }) }) };
    const cfg = await loadConfig("tenant-x", mockDb as any);
    expect(cfg.topK).toBe(DEFAULTS.topK);
  });
});

describe("saveConfigField", () => {
  it("upserts with tenant, key, value", async () => {
    let bound: unknown[] = [];
    let sql = "";
    const mockDb = {
      prepare: (s: string) => {
        sql = s;
        return { bind: (...a: unknown[]) => { bound = a; return { run: async () => ({}) }; } };
      },
    };
    await saveConfigField("t1", mockDb as any, "topK", "7");
    expect(sql).toContain("ON CONFLICT");
    expect(bound).toEqual(["t1", "topK", "7"]);
  });
});
