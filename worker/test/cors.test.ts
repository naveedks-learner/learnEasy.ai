import { describe, it, expect } from "vitest";
import { buildCorsHeaders } from "../src/cors";

describe("buildCorsHeaders", () => {
  it("allows origin from tenant config", () => {
    const h = buildCorsHeaders("https://chat.schoola.com", ["https://chat.schoola.com"], "admin.learneasy.ai");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://chat.schoola.com");
  });

  it("allows admin hostname origin", () => {
    const h = buildCorsHeaders("https://admin.learneasy.ai", [], "admin.learneasy.ai");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://admin.learneasy.ai");
  });

  it("rejects unknown origin", () => {
    const h = buildCorsHeaders("https://evil.com", ["https://chat.schoola.com"], "admin.learneasy.ai");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("allows wildcard in dev", () => {
    const h = buildCorsHeaders("https://anything.com", ["*"], "admin.localhost");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://anything.com");
  });

  it("rejects malformed origin", () => {
    const h = buildCorsHeaders("not a url", [], "admin.learneasy.ai");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
