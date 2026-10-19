import { Hono } from "hono";
import type { Env } from "./env";
import { corsMiddleware } from "./cors";
import { resolveTenant, UnknownTenantError, type TenantConfig } from "./tenant";

import { TenantStorage } from "./storage";
import { handleIngest } from "./ingestion";
import { handleChat } from "./chat";
import { handleExplain } from "./explain";
import { adminRoutes } from "./admin";

type AppEnv = { Bindings: Env; Variables: { tenant: TenantConfig } };

const app = new Hono<AppEnv>();

app.get("/health", async (c) => {
  let tenantCount = -1;
  try {
    const row = await c.env.DB.prepare("SELECT COUNT(*) as count FROM tenants").first<{ count: number }>();
    if (row && typeof row.count === "number") tenantCount = row.count;
  } catch {
    tenantCount = -1;
  }
  return c.json({ ok: true, tenantCount });
});

app.route("/admin", adminRoutes);

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const override = c.req.header("X-Tenant") ?? url.searchParams.get("tenant") ?? undefined;
  try {
    const tenant = await resolveTenant(url.host, c.env, { tenantOverride: override });
    c.set("tenant", tenant);
  } catch (err) {
    if (err instanceof UnknownTenantError) return c.json({ error: "Unknown school" }, 404);
    throw err;
  }
  await next();
});

app.use("*", corsMiddleware);

app.get("/api/tenant", (c) => {
  const { tenantId, name, logoUrl, theme, features } = c.get("tenant");
  return c.json({ tenantId, name, logoUrl, theme, features });
});

app.get("/manifest.json", (c) => {
  const t = c.get("tenant");
  return c.json({
    name: t.name,
    short_name: t.name.slice(0, 12),
    start_url: "/",
    display: "standalone",
    theme_color: t.theme.primaryColor,
    background_color: "#ffffff",
    icons: t.logoUrl ? [{ src: t.logoUrl, sizes: "192x192", type: "image/png" }] : [],
  });
});

app.get("/api/images/*", async (c) => {
  const prefix = "/api/images/";
  const path = new URL(c.req.url).pathname;
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  const parts = rest
    .split("/")
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return "";
      }
    })
    .filter((p) => p !== "" && p !== "." && p !== ".." && !p.includes("\\") && !p.includes("\0"));
  if (parts.length === 0) return c.json({ error: "Not found" }, 404);
  const storage = new TenantStorage(c.get("tenant").tenantId, c.env);
  const obj = await c.env.PDF_BUCKET.get(storage.r2Key("images", ...parts));
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
});

app.post("/api/ingest", (c) => handleIngest(c.req.raw, c.env, c.get("tenant"), c.executionCtx as ExecutionContext));

app.post("/api/chat", (c) => handleChat(c.req.raw, c.env, c.get("tenant"), c.executionCtx as ExecutionContext));

app.post("/api/explain", (c) => handleExplain(c.req.raw, c.env, c.get("tenant"), c.executionCtx as ExecutionContext));

export default app;
