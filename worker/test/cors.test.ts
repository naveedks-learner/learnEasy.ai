import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { buildCorsHeaders, corsMiddleware } from "../src/cors";

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

describe("corsMiddleware", () => {
  const app = new Hono<any>();
  app.use("*", async (c, next) => {
    c.set("tenant", { allowedOrigins: ["https://chat.schoola.com"] });
    await next();
  });
  app.use("*", corsMiddleware);
  app.get("/x", (c) => c.json({ ok: true }));
  const env = { ADMIN_HOSTNAME: "admin.learneasy.ai" };
  const good = { Origin: "https://chat.schoola.com" };

  it("answers OPTIONS preflight with 204 and CORS headers", async () => {
    const res = await app.request("/x", { method: "OPTIONS", headers: good }, env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://chat.schoola.com");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
  });

  it("adds CORS headers to normal responses", async () => {
    const res = await app.request("/x", { headers: good }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://chat.schoola.com");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("omits Allow-Origin for unknown origin but keeps Vary", async () => {
    const res = await app.request("/x", { headers: { Origin: "https://evil.com" } }, env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });
});
