import { describe, it, expect } from "vitest";
import { rerank } from "../src/rerank";

describe("rerank", () => {
  const chunks = [
    { text: "less relevant", score: 0.9 },
    { text: "more relevant", score: 0.7 },
  ];

  it("reorders chunks by cross-encoder score", async () => {
    const env = {
      AI: { run: async () => ({ data: [{ score: 0.3 }, { score: 0.8 }] }) },
    } as any;
    const result = await rerank("query", chunks, env);
    expect(result[0].text).toBe("more relevant");
  });

  it("fails open — returns original order on AI error", async () => {
    const env = { AI: { run: async () => { throw new Error("AI down"); } } } as any;
    const result = await rerank("query", chunks, env);
    expect(result[0].text).toBe("less relevant");
  });
});
