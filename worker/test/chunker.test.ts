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

  it("keeps a Markdown table intact within a single chunk", () => {
    const tableText = [
      "Introduction text here.",
      "| Name | Value |",
      "|------|-------|",
      "| A    | 1     |",
      "| B    | 2     |",
      "| C    | 3     |",
      "Conclusion text.",
    ].join("\n");
    // Small chunk size to force splitting, but table should stay together
    const chunks = chunkText([{ page: 1, text: tableText }], { chunkSize: 5, overlap: 1 });
    const tableChunk = chunks.find((c) => c.text.includes("Name") && c.text.includes("Value"));
    expect(tableChunk).toBeDefined();
    // All table rows should be in the same chunk
    expect(tableChunk!.text).toContain("A");
    expect(tableChunk!.text).toContain("B");
    expect(tableChunk!.text).toContain("C");
  });

  it("does not split a table across chunks even when it exceeds chunkSize", () => {
    const rows = Array.from({ length: 20 }, (_, i) => `| Item${i} | ${i * 10} |`);
    const tableText = [
      "Preamble word word word",
      "| Item | Score |",
      "|------|-------|",
      ...rows,
      "After table word word",
    ].join("\n");
    const chunks = chunkText([{ page: 1, text: tableText }], { chunkSize: 10, overlap: 2 });
    // Find the chunk that contains the header
    const headerChunk = chunks.find((c) => c.text.includes("Score"));
    expect(headerChunk).toBeDefined();
    // Should contain all rows
    expect(headerChunk!.text).toContain("Item19");
  });

  it("handles text with no tables normally", () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText([{ page: 1, text }], { chunkSize: 30, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text.split(" ").length).toBe(30);
  });

  it("handles multiple tables on different pages", () => {
    const page1 = "| A | B |\n|---|---|\n| 1 | 2 |\nText after first table";
    const page2 = "| X | Y |\n|---|---|\n| 3 | 4 |\nText after second table";
    const chunks = chunkText(
      [
        { page: 1, text: page1 },
        { page: 2, text: page2 },
      ],
      { chunkSize: 5, overlap: 1 },
    );
    const t1 = chunks.find((c) => c.text.includes("A") && c.text.includes("B") && c.text.includes("1") && c.text.includes("2"));
    const t2 = chunks.find((c) => c.text.includes("X") && c.text.includes("Y") && c.text.includes("3") && c.text.includes("4"));
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
  });

  it("preserves overlap for non-table text around tables", () => {
    const text = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ") +
      "\n| H1 | H2 |\n|---|---|\n| a | b |\n" +
      Array.from({ length: 50 }, (_, i) => `x${i}`).join(" ");
    const chunks = chunkText([{ page: 1, text }], { chunkSize: 20, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("single page with just a table", () => {
    const text = "| Col1 | Col2 |\n|------|------|\n| a | b |\n| c | d |";
    const chunks = chunkText([{ page: 1, text }], { chunkSize: 3, overlap: 1 });
    // Table should be one chunk
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain("Col1");
    expect(chunks[0].text).toContain("d");
  });

  it("custom chunk size and overlap", () => {
    const text = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkText([{ page: 1, text }], { chunkSize: 50, overlap: 10 });
    expect(chunks.length).toBe(3);
  });

  it("handles text shorter than chunk size", () => {
    const chunks = chunkText([{ page: 1, text: "hello world" }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("hello world");
    expect(chunks[0].startPage).toBe(1);
    expect(chunks[0].endPage).toBe(1);
  });

  it("figure pages set pageImageKey even across chunk boundary", () => {
    const pages = [
      { page: 1, text: Array(280).fill("w").join(" ") },
      { page: 2, text: "[Figure: diagram] " + Array(280).fill("w").join(" ") },
    ];
    const chunks = chunkText(pages);
    const figChunk = chunks.find((c) => c.pageImageKey);
    expect(figChunk).toBeDefined();
    expect(figChunk!.pageImageKey).toBe("2.png");
  });
});
