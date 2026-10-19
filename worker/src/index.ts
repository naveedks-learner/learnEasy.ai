import { Hono } from "hono";
import type { Env } from "./env";
import { corsMiddleware } from "./cors";
import { resolveTenant, UnknownTenantError, type TenantConfig } from "./tenant";

import { handleIngest } from "./ingestion";
import { handleChat } from "./chat";
import { handleExplain } from "./explain";
import { adminRoutes } from "./admin";

type AppEnv = { Bindings: Env; Variables: { tenant: TenantConfig } };

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));

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
  const { tenantId, name, logoUrl, theme } = c.get("tenant");
  return c.json({ tenantId, name, logoUrl, theme });
});

app.post("/api/ingest", (c) => handleIngest(c.req.raw, c.env, c.get("tenant"), c.executionCtx as ExecutionContext));

app.post("/api/chat", (c) => handleChat(c.req.raw, c.env, c.get("tenant"), c.executionCtx as ExecutionContext));

app.post("/api/explain", (c) => handleExplain(c.req.raw, c.env, c.get("tenant"), c.executionCtx as ExecutionContext));

export default app;
