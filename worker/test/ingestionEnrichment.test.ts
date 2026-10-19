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

  it("never throws — returns plain pages on garbage input", () => {
    const plain = [{ page: 1, text: "plain 1" }];
    expect(parseEnrichedPages("", plain)).toEqual(plain);
    expect(parseEnrichedPages("no markers here", plain)).toEqual(plain);
    expect(parseEnrichedPages(null as any, plain)).toEqual(plain);
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
