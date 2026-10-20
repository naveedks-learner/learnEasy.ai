import { describe, it, expect } from "vitest";
import { capturePageScreenshots } from "../src/screenshots";

function makeStorage(tenantId = "t1") {
  return {
    tenantId,
    r2Key: (...parts: string[]) => `t/${tenantId}/${parts.join("/")}`,
  } as any;
}

describe("capturePageScreenshots", () => {
  it("returns empty set when no figure pages", async () => {
    const result = await capturePageScreenshots([], new Set(), makeStorage(), "test.pdf", {} as any);
    expect(result.size).toBe(0);
  });

  it("captures screenshots for figure pages when Browser returns 200", async () => {
    const puts: Array<{ key: string }> = [];
    const env = {
      BROWSER: {
        fetch: async () => new Response(new Uint8Array([137, 80, 78, 71]).buffer, { status: 200 }),
      },
      PDF_BUCKET: {
        put: async (key: string, body: any, opts: any) => { puts.push({ key }); },
      },
    } as any;

    const pages = [
      { page: 1, text: "normal" },
      { page: 2, text: "[Figure: diagram of a cell]" },
      { page: 3, text: "[Figure: chart]" },
    ];
    const figurePages = new Set([2, 3]);
    const result = await capturePageScreenshots(pages, figurePages, makeStorage(), "bio.pdf", env);

    expect(result.size).toBe(2);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(true);
    expect(puts).toHaveLength(2);
    expect(puts[0].key).toContain("images");
    expect(puts[0].key).toContain("2.png");
  });

  it("fails open when Browser returns error", async () => {
    const env = {
      BROWSER: {
        fetch: async () => new Response("error", { status: 500 }),
      },
      PDF_BUCKET: {
        put: async () => {},
      },
    } as any;

    const pages = [{ page: 1, text: "[Figure: broken]" }];
    const result = await capturePageScreenshots(pages, new Set([1]), makeStorage(), "test.pdf", env);
    expect(result.size).toBe(0);
  });

  it("fails open when Browser fetch throws", async () => {
    const env = {
      BROWSER: {
        fetch: async () => { throw new Error("network error"); },
      },
      PDF_BUCKET: {
        put: async () => {},
      },
    } as any;

    const pages = [{ page: 1, text: "[Figure: broken]" }];
    const result = await capturePageScreenshots(pages, new Set([1]), makeStorage(), "test.pdf", env);
    expect(result.size).toBe(0);
  });

  it("skips pages not found in the pages array", async () => {
    const puts: string[] = [];
    const env = {
      BROWSER: {
        fetch: async () => new Response(new Uint8Array([1]).buffer, { status: 200 }),
      },
      PDF_BUCKET: {
        put: async (key: string) => { puts.push(key); },
      },
    } as any;

    const pages = [{ page: 1, text: "text" }];
    const result = await capturePageScreenshots(pages, new Set([1, 99]), makeStorage(), "test.pdf", env);
    expect(result.has(1)).toBe(true);
    expect(result.has(99)).toBe(false);
    expect(puts).toHaveLength(1);
  });
});
