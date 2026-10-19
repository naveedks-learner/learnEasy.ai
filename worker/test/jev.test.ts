import { describe, it, expect } from "vitest";
import { jevFilter } from "../src/jev";
import { DEFAULTS } from "../src/config";

describe("jevFilter", () => {
  it("keeps chunks above relevance threshold", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"relevance": 3, "injection": false}' } }],
    }));
    const config = { ...DEFAULTS, jevEnabled: true, jevRelevanceThreshold: 1.5 };
    const env = { OPENROUTER_API_KEY: "key" } as any;
    const result = await jevFilter("query", [{ text: "chunk1" }], config, env);
    expect(result[0].kept).toBe(true);
    expect(result[0].jevScore).toBe(3);
  });

  it("discards chunks below threshold", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"relevance": 0.5, "injection": false}' } }],
    }));
    const config = { ...DEFAULTS, jevEnabled: true, jevRelevanceThreshold: 1.5 };
    const env = { OPENROUTER_API_KEY: "key" } as any;
    const result = await jevFilter("query", [{ text: "chunk1" }], config, env);
    expect(result[0].kept).toBe(false);
  });

  it("discards chunks flagged as injection", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"relevance": 5, "injection": true}' } }],
    }));
    const config = { ...DEFAULTS, jevEnabled: true };
    const result = await jevFilter("query", [{ text: "chunk1" }], config, { OPENROUTER_API_KEY: "k" } as any);
    expect(result[0].kept).toBe(false);
  });

  it("fails open — marks all as kept on error", async () => {
    globalThis.fetch = async () => { throw new Error("down"); };
    const config = { ...DEFAULTS, jevEnabled: true };
    const env = { OPENROUTER_API_KEY: "key" } as any;
    const result = await jevFilter("query", [{ text: "chunk1" }], config, env);
    expect(result[0].kept).toBe(true);
  });

  it("passes all through when disabled", async () => {
    const config = { ...DEFAULTS, jevEnabled: false };
    const result = await jevFilter("query", [{ text: "chunk1" }], config, {} as any);
    expect(result[0].kept).toBe(true);
  });
});
