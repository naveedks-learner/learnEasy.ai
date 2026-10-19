import { describe, it, expect, vi, afterEach } from "vitest";
import { handleChat } from "../src/chat";
import { DEFAULT_FEATURES, DEFAULT_RATE_LIMITS, DEFAULT_THEME, type TenantConfig } from "../src/tenant";

interface MockOpts {
  vectorizeResults?: any[];
  llmResponse?: string;
  rateLimitCount?: number;
  configRows?: Array<{ key: string; value: string }>;
  onVectorizeQuery?: (emb: number[], opts: any) => void;
  inserts?: any[][];
}

function mockChatEnv(o: MockOpts): any {
  const configRows = o.configRows ?? [
    { key: "jevEnabled", value: "false" },
    { key: "llmProvider", value: "workers-ai" },
  ];
  return {
    ENVIRONMENT: "test",
    OPENROUTER_API_KEY: "k",
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => (sql.includes("rate_limits") ? { count: o.rateLimitCount ?? 0 } : null),
          all: async () => ({ results: sql.includes("FROM config") ? configRows : [] }),
          run: async () => {
            if (sql.includes("INSERT INTO transactions")) o.inserts?.push(args);
            return {};
          },
        }),
      }),
    },
    AI: {
      run: async (model: string) => {
        if (model.includes("bge-base")) return { data: [[0.1, 0.2, 0.3]] };
        if (model.includes("reranker")) return {};
        return { response: o.llmResponse ?? "answer" };
      },
    },
    VECTORIZE: {
      query: async (emb: number[], opts: any) => {
        o.onVectorizeQuery?.(emb, opts);
        return { matches: o.vectorizeResults ?? [], count: 0 };
      },
    },
  };
}

function mockTenant(tenantId: string, webSearchEnabled = false): TenantConfig {
  return {
    tenantId,
    name: "School",
    logoUrl: "",
    theme: DEFAULT_THEME,
    allowedOrigins: [],
    domain: "x.test",
    features: { ...DEFAULT_FEATURES, webSearchEnabled },
    rateLimits: DEFAULT_RATE_LIMITS,
  };
}

function mockCtx(): any {
  return { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException() {} };
}

function chatRequest(question: string, extra: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ question, ...extra }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("handleChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns an answer using the full pipeline", async () => {
    const env = mockChatEnv({
      vectorizeResults: [
        { id: "v1", score: 0.9, metadata: { tenantId: "t1", filename: "physics.pdf", page: "1", text: "Force equals mass times acceleration" } },
      ],
      llmResponse: "Force is F = ma",
    });
    const res = await handleChat(chatRequest("What is force?"), env, mockTenant("t1"), mockCtx());
    const body = (await res.json()) as any;
    expect(body.answer).toBe("Force is F = ma");
    expect(body.docSources).toHaveLength(1);
    expect(body.docSources[0]).toMatchObject({ filename: "physics.pdf", page: 1 });
  });

  it("blocks when guardrail triggers", async () => {
    const res = await handleChat(chatRequest("how to make a bomb"), mockChatEnv({}), mockTenant("t1"), mockCtx());
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).blocked).toBe(true);
  });

  it("rate-limits when over tenant limit", async () => {
    const res = await handleChat(chatRequest("test"), mockChatEnv({ rateLimitCount: 999 }), mockTenant("t1"), mockCtx());
    expect(res.status).toBe(429);
  });

  it("includes tenant filter in Vectorize query", async () => {
    let queriedFilter: any;
    const env = mockChatEnv({ onVectorizeQuery: (_: number[], opts: any) => { queriedFilter = opts.filter; } });
    await handleChat(chatRequest("test question"), env, mockTenant("t1"), mockCtx());
    expect(queriedFilter).toEqual({ tenantId: "t1" });
  });

  it("drops chunks below the confidence threshold", async () => {
    const env = mockChatEnv({
      configRows: [
        { key: "jevEnabled", value: "false" },
        { key: "llmProvider", value: "workers-ai" },
        { key: "confidenceThreshold", value: "0.5" },
      ],
      vectorizeResults: [{ id: "v1", score: 0.2, metadata: { filename: "a.pdf", page: "1", text: "weak" } }],
    });
    const res = await handleChat(chatRequest("q"), env, mockTenant("t1"), mockCtx());
    expect(((await res.json()) as any).docSources).toHaveLength(0);
  });

  it("records a transaction for the tenant", async () => {
    const inserts: any[][] = [];
    const env = mockChatEnv({ inserts });
    await handleChat(chatRequest("q"), env, mockTenant("t1"), mockCtx());
    await new Promise((r) => setTimeout(r, 0));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toBe("t1");
  });

  it("rejects a missing question", async () => {
    const res = await handleChat(chatRequest(""), mockChatEnv({}), mockTenant("t1"), mockCtx());
    expect(res.status).toBe(400);
  });
  it("falls back to web search when no documents are kept, and still calls the LLM", async () => {
    const ddg = '<a class="result__a" href="https://example.com/x">Force</a><a class="result__snippet">Force is a push or pull</a>';
    vi.stubGlobal("fetch", async () => new Response(ddg));
    let llmCalls = 0;
    const env = mockChatEnv({ llmResponse: "From the web" });
    const baseRun = env.AI.run;
    env.AI.run = async (model: string, input: any) => {
      if (!model.includes("bge") && !model.includes("reranker")) llmCalls++;
      return baseRun(model, input);
    };
    const res = await handleChat(chatRequest("q"), env, mockTenant("t1", true), mockCtx());
    const body = (await res.json()) as any;
    expect(body.docSources).toHaveLength(0);
    expect(body.webSources).toHaveLength(1);
    expect(body.webSources[0].url).toBe("https://example.com/x");
    expect(body.answer).toBe("From the web");
    expect(llmCalls).toBe(1);
  });

  it("propagates LLM errors instead of swallowing them", async () => {
    const env = mockChatEnv({});
    const baseRun = env.AI.run;
    env.AI.run = async (model: string, input: any) => {
      if (!model.includes("bge") && !model.includes("reranker")) throw new Error("llm down");
      return baseRun(model, input);
    };
    await expect(handleChat(chatRequest("q"), env, mockTenant("t1"), mockCtx())).rejects.toThrow("llm down");
  });
});
