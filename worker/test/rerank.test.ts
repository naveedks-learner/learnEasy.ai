import { describe, it, expect } from "vitest";
import { rerank } from "../src/rerank";

describe("rerank", () => {
  const chunks = [
    { text: "Mercury is the closest planet to the sun", score: 0.9 },
    { text: "Photosynthesis converts sunlight to energy", score: 0.7 },
    { text: "The solar system has eight planets", score: 0.6 },
  ];

  function mockEnv(response: any) {
    return { AI: { run: async () => response } } as any;
  }

  it("reorders chunks by cross-encoder score using response[].id+score", async () => {
    const env = mockEnv({
      response: [
        { id: 0, score: 0.2 },
        { id: 1, score: 0.1 },
        { id: 2, score: 0.95 },
      ],
    });
    const result = await rerank("what are the planets", chunks, env);
    expect(result[0].text).toBe("The solar system has eight planets");
    expect(result[0].rerankScore).toBe(0.95);
    expect(result[1].text).toBe("Mercury is the closest planet to the sun");
    expect(result[2].text).toBe("Photosynthesis converts sunlight to energy");
  });

  it("maps scores by id, not by array position", async () => {
    const env = mockEnv({
      response: [
        { id: 2, score: 0.9 },
        { id: 0, score: 0.5 },
        { id: 1, score: 0.1 },
      ],
    });
    const result = await rerank("query", chunks, env);
    expect(result[0].rerankScore).toBe(0.9);
    expect(result[0].text).toContain("solar system");
    expect(result[1].rerankScore).toBe(0.5);
    expect(result[1].text).toContain("Mercury");
    expect(result[2].rerankScore).toBe(0.1);
    expect(result[2].text).toContain("Photosynthesis");
  });

  it("preserves original chunk properties through reranking", async () => {
    const chunksWithMeta = [
      { text: "chunk A", score: 0.8, filename: "a.pdf", page: 1 },
      { text: "chunk B", score: 0.6, filename: "b.pdf", page: 3 },
    ];
    const env = mockEnv({
      response: [{ id: 0, score: 0.3 }, { id: 1, score: 0.7 }],
    });
    const result = await rerank("query", chunksWithMeta, env);
    expect(result[0].filename).toBe("b.pdf");
    expect(result[0].page).toBe(3);
    expect(result[0].rerankScore).toBe(0.7);
    expect(result[0].score).toBe(0.6);
  });

  it("fails open — returns original order on AI error", async () => {
    const env = { AI: { run: async () => { throw new Error("AI down"); } } } as any;
    const result = await rerank("query", chunks, env);
    expect(result[0].text).toBe(chunks[0].text);
    expect(result[0].rerankScore).toBeUndefined();
  });

  it("fails open when response is not an array", async () => {
    const env = mockEnv({ response: "invalid" });
    const result = await rerank("query", chunks, env);
    expect(result).toEqual(chunks);
  });

  it("fails open when response length doesn't match chunks", async () => {
    const env = mockEnv({
      response: [{ id: 0, score: 0.5 }],
    });
    const result = await rerank("query", chunks, env);
    expect(result).toEqual(chunks);
  });

  it("fails open when a row has non-finite score", async () => {
    const env = mockEnv({
      response: [
        { id: 0, score: NaN },
        { id: 1, score: 0.5 },
        { id: 2, score: 0.3 },
      ],
    });
    const result = await rerank("query", chunks, env);
    expect(result).toEqual(chunks);
  });

  it("fails open when response uses old { data } format", async () => {
    const env = mockEnv({ data: [{ score: 0.5 }, { score: 0.3 }] });
    const result = await rerank("query", chunks, env);
    expect(result).toEqual(chunks);
  });

  it("returns empty array for empty input", async () => {
    const env = mockEnv({});
    const result = await rerank("query", [], env);
    expect(result).toEqual([]);
  });

  it("handles single chunk", async () => {
    const env = mockEnv({ response: [{ id: 0, score: 0.8 }] });
    const result = await rerank("query", [chunks[0]], env);
    expect(result[0].rerankScore).toBe(0.8);
  });
});
