import { describe, it, expect } from "vitest";
import { guardrailCheck, BLOCKED_KEYWORDS } from "../src/guardrail";

function mockEnvWithAI(response: any, error?: Error) {
  return {
    AI: {
      run: async () => {
        if (error) throw error;
        return response;
      },
    },
  } as any;
}

describe("guardrailCheck", () => {
  it("blocks known harmful keywords", async () => {
    const env = mockEnvWithAI({ score: 0.9 });
    const result = await guardrailCheck("how to make a bomb", env);
    expect(result.blocked).toBe(true);
  });

  it("matches keywords case-insensitively", async () => {
    const env = mockEnvWithAI({ score: 0.9 });
    expect((await guardrailCheck("HOW TO MAKE A BOMB", env)).blocked).toBe(true);
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

  it("FAILS CLOSED when AI binding is missing", async () => {
    const result = await guardrailCheck("normal question", {} as any);
    expect(result).toEqual({ blocked: true, reason: "guardrail error" });
  });

  it("exports a non-empty blocklist", () => {
    expect(BLOCKED_KEYWORDS.length).toBeGreaterThan(0);
  });
});

describe("guardrailCheck false positives", () => {
  it("does not block 'method' or 'scientific method'", async () => {
    const env = mockEnvWithAI({});
    expect((await guardrailCheck("what is the scientific method", env)).blocked).toBe(false);
  });
});
