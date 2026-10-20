import { describe, it, expect } from "vitest";
import { parseEnrichedPages, enrichPdfToMarkdown } from "../src/ingestionEnrichment";
import { DEFAULTS } from "../src/config";

describe("parseEnrichedPages", () => {
  it("merges enriched text onto plain pages by page number", () => {
    const enriched = "<<<PAGE 1>>>\n# Enriched page 1\n<<<PAGE 2>>>\n# Enriched page 2";
    const plain = [{ page: 1, text: "plain 1" }, { page: 2, text: "plain 2" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result[0].text).toContain("Enriched page 1");
    expect(result[1].text).toContain("Enriched page 2");
  });

  it("falls back to plain text for pages missing from enriched output", () => {
    const enriched = "<<<PAGE 1>>>\n# Enriched page 1";
    const plain = [{ page: 1, text: "plain 1" }, { page: 2, text: "plain 2" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result[0].text).toContain("Enriched page 1");
    expect(result[1].text).toBe("plain 2");
  });

  it("ignores enriched markers for pages not in plainPages", () => {
    const enriched = "<<<PAGE 1>>>\nE1\n<<<PAGE 2>>>\nE2\n<<<PAGE 3>>>\nE3";
    const plain = [{ page: 1, text: "plain 1" }, { page: 2, text: "plain 2" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.page)).toEqual([1, 2]);
    expect(result[0].text).toBe("E1");
    expect(result[1].text).toBe("E2");
  });

  it("never throws — returns plain pages on garbage input", () => {
    const plain = [{ page: 1, text: "plain 1" }];
    expect(parseEnrichedPages("", plain)).toEqual(plain);
    expect(parseEnrichedPages("no markers here", plain)).toEqual(plain);
    expect(parseEnrichedPages(null as any, plain)).toEqual(plain);
  });

  it("preserves Markdown tables in enriched output", () => {
    const enriched = "<<<PAGE 1>>>\n| Col | Val |\n|-----|-----|\n| A   | 1   |";
    const plain = [{ page: 1, text: "plain text" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result[0].text).toContain("| Col | Val |");
    expect(result[0].text).toContain("| A   | 1   |");
  });

  it("preserves LaTeX formulas in enriched output", () => {
    const enriched = "<<<PAGE 1>>>\nThe formula is $E = mc^2$ and also $$F = ma$$";
    const plain = [{ page: 1, text: "plain" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result[0].text).toContain("$E = mc^2$");
    expect(result[0].text).toContain("$$F = ma$$");
  });

  it("preserves [Figure: ...] tags in enriched output", () => {
    const enriched = "<<<PAGE 1>>>\nSome text\n[Figure: Diagram of a cell]\nMore text";
    const plain = [{ page: 1, text: "plain" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result[0].text).toContain("[Figure: Diagram of a cell]");
  });

  it("handles duplicate page markers by taking the first occurrence", () => {
    const enriched = "<<<PAGE 1>>>\nFirst version\n<<<PAGE 1>>>\nSecond version";
    const plain = [{ page: 1, text: "plain" }];
    const result = parseEnrichedPages(enriched, plain);
    expect(result[0].text).toBe("First version");
  });
});

describe("enrichPdfToMarkdown", () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;

  it("returns null when disabled without calling fetch", async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as any;
    const r = await enrichPdfToMarkdown(bytes, { ...DEFAULTS, ingestionEnrichmentEnabled: false }, {} as any);
    expect(r).toBeNull();
    expect(called).toBe(false);
  });

  it("returns model text on success", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "<<<PAGE 1>>>\nhi" } }] }))) as any;
    const r = await enrichPdfToMarkdown(bytes, DEFAULTS, { OPENROUTER_API_KEY: "k" } as any);
    expect(r).toContain("<<<PAGE 1>>>");
  });

  it("fails open to null on error", async () => {
    globalThis.fetch = (async () => new Response("err", { status: 500 })) as any;
    expect(await enrichPdfToMarkdown(bytes, DEFAULTS, { OPENROUTER_API_KEY: "k" } as any)).toBeNull();
    globalThis.fetch = (async () => { throw new Error("net"); }) as any;
    expect(await enrichPdfToMarkdown(bytes, DEFAULTS, { OPENROUTER_API_KEY: "k" } as any)).toBeNull();
  });
});
