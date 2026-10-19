import { describe, it, expect } from "vitest";
import { generateChatCompletion } from "../src/llm";
import { DEFAULTS } from "../src/config";

describe("generateChatCompletion", () => {
  it("calls OpenRouter when provider is openrouter", async () => {
    let calledUrl = "";
    const env = {
      OPENROUTER_API_KEY: "test-key",
      AI: { run: async () => ({}) },
    } as any;
    globalThis.fetch = (async (url: any) => {
      calledUrl = url;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "answer" } }],
        usage: { total_tokens: 100 },
      }));
    }) as any;
    const result = await generateChatCompletion(
      [{ role: "user", content: "hi" }],
      { ...DEFAULTS, llmProvider: "openrouter" },
      env,
    );
    expect(calledUrl).toContain("openrouter.ai");
    expect(result.text).toBe("answer");
    expect(result.provider).toBe("openrouter");
    expect(result.tokenEstimate).toBe(100);
  });

  it("throws on OpenRouter failure (does NOT fail open)", async () => {
    const env = { OPENROUTER_API_KEY: "test-key" } as any;
    globalThis.fetch = (async () => new Response("error", { status: 500 })) as any;
    await expect(
      generateChatCompletion([{ role: "user", content: "hi" }], { ...DEFAULTS, llmProvider: "openrouter" }, env),
    ).rejects.toThrow();
  });

  it("uses modelOverride", async () => {
    let body: any;
    globalThis.fetch = (async (_u: any, init: any) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }));
    }) as any;
    const r = await generateChatCompletion([{ role: "user", content: "hi" }], DEFAULTS, { OPENROUTER_API_KEY: "k" } as any, {
      modelOverride: "foo/bar",
      maxTokens: 50,
    });
    expect(body.model).toBe("foo/bar");
    expect(body.max_tokens).toBe(50);
    expect(r.model).toBe("foo/bar");
  });

  it("routes to Workers AI and throws on its error", async () => {
    const ok = { AI: { run: async () => ({ response: "hello" }) } } as any;
    const r = await generateChatCompletion([{ role: "user", content: "hi" }], { ...DEFAULTS, llmProvider: "workers-ai" }, ok);
    expect(r.text).toBe("hello");
    expect(r.provider).toBe("workers-ai");
    const bad = { AI: { run: async () => { throw new Error("boom"); } } } as any;
    await expect(
      generateChatCompletion([{ role: "user", content: "hi" }], { ...DEFAULTS, llmProvider: "workers-ai" }, bad),
    ).rejects.toThrow();
  });
});
