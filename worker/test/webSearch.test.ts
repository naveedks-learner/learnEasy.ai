import { describe, it, expect, afterEach } from "vitest";
import { webSearch } from "../src/webSearch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("webSearch", () => {
  it("parses titles, snippets and unwraps redirect urls", async () => {
    globalThis.fetch = async () =>
      new Response(
        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Ti<b>tle</b></a><a class="result__snippet">Snip &amp; more</a>',
      );
    const results = await webSearch("test query");
    expect(results).toEqual([{ title: "Title", snippet: "Snip & more", url: "https://example.com/a" }]);
  });

  it("never throws — returns empty on error", async () => {
    globalThis.fetch = async () => {
      throw new Error("network");
    };
    expect(await webSearch("test query")).toEqual([]);
  });

  it("returns empty on non-ok response", async () => {
    globalThis.fetch = async () => new Response("no", { status: 503 });
    expect(await webSearch("q")).toEqual([]);
  });
});
