import { describe, it, expect } from "vitest";
import { parseExplainLlmResponse, handleExplain } from "../src/explain";
import { DEFAULT_FEATURES, DEFAULT_RATE_LIMITS, DEFAULT_THEME, type TenantConfig } from "../src/tenant";

describe("parseExplainLlmResponse", () => {
  it("parses valid JSON from fenced code block", () => {
    const raw = '```json\n{"concept":"force","simpleExplanation":"push or pull","steps":null,"formula":"F=ma","definition":"Force is...","table":null,"realWorldExample":"kicking a ball"}\n```';
    const result = parseExplainLlmResponse(raw);
    expect(result.concept).toBe("force");
    expect(result.formula).toBe("F=ma");
  });

  it("never throws — falls back to raw text in simpleExplanation", () => {
    const result = parseExplainLlmResponse("this is not json at all");
    expect(result.simpleExplanation).toBe("this is not json at all");
    expect(result.formula).toBeNull();
  });

  it("handles truncated JSON gracefully", () => {
    const result = parseExplainLlmResponse('```json\n{"concept":"force","simpleExp');
    expect(result.simpleExplanation).toBeTruthy();
  });

  it("falls back when JSON lacks simpleExplanation", () => {
    const result = parseExplainLlmResponse('{"concept":"force"}');
    expect(result.simpleExplanation).toBe('{"concept":"force"}');
  });
});

describe("handleExplain", () => {
  const tenant: TenantConfig = {
    tenantId: "t1", name: "School", logoUrl: "", theme: DEFAULT_THEME, allowedOrigins: [],
    domain: "x.test", features: { ...DEFAULT_FEATURES }, rateLimits: DEFAULT_RATE_LIMITS,
  };
  const ctx: any = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException() {} };
  const req = (body: string) => new Request("http://localhost/api/explain", { method: "POST", body });
  const env: any = {
    ENVIRONMENT: "test", OPENROUTER_API_KEY: "k",
    DB: { prepare: (sql: string) => ({ bind: () => ({
      first: async () => (sql.includes("rate_limits") ? { count: 0 } : null),
      all: async () => ({ results: sql.includes("FROM config") ? [{ key: "jevEnabled", value: "false" }, { key: "llmProvider", value: "workers-ai" }] : [] }),
      run: async () => ({}),
    }) }) },
    AI: { run: async (model: string) => {
      if (model.includes("bge-base")) return { data: [[0.1, 0.2, 0.3]] };
      if (model.includes("reranker")) return {};
      return { response: "```json\n" + JSON.stringify({ concept: "force", simpleExplanation: "a push or pull", steps: null, formula: "F=ma", definition: null, table: null, realWorldExample: null }) + "\n```" };
    } },
    VECTORIZE: { query: async () => ({ matches: [{ id: "v1", score: 0.9, metadata: { tenantId: "t1", filename: "p.pdf", page: "1", text: "Force equals mass times acceleration" } }], count: 1 }) },
  };

  it("returns structured explanation with groundedIn", async () => {
    const res = await handleExplain(req(JSON.stringify({ concept: "force" })), env, tenant, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.concept).toBe("force");
    expect(body.simpleExplanation).toBe("a push or pull");
    expect(body.groundedIn).toBe("both");
  });

  it("returns 400 for a null JSON body", async () => {
    const res = await handleExplain(req("null"), env, tenant, ctx);
    expect(res.status).toBe(400);
  });
});
