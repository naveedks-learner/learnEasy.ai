import { describe, it, expect } from "vitest";
import { chunkText } from "../src/chunker";

describe("chunkText", () => {
  it("splits text into 300-word chunks with 50-word overlap by default", () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
    const chunks = chunkText([{ page: 1, text: words.join(" ") }]);
    expect(chunks.length).toBe(3);
    expect(chunks[0].startPage).toBe(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].text.split(" ")[0]).toBe("word250");
  });

  it("tracks page boundaries across chunks", () => {
    const pages = [
      { page: 1, text: Array(200).fill("w").join(" ") },
      { page: 2, text: Array(200).fill("w").join(" ") },
    ];
    const chunks = chunkText(pages);
    expect(chunks[0].startPage).toBe(1);
    expect(chunks[0].endPage).toBe(2);
  });

  it("carries pageImageKey when page text contains [Figure:", () => {
    const pages = [{ page: 3, text: "some text [Figure: a diagram] more text " + Array(280).fill("w").join(" ") }];
    expect(chunkText(pages)[0].pageImageKey).toBeTruthy();
  });

  it("returns empty array for empty input", () => {
    expect(chunkText([])).toEqual([]);
  });
});
