import { Hono } from "hono";
import type { Env } from "./env";
import { resolveTenant, type TenantConfig } from "./tenant";

type AppEnv = { Bindings: Env; Variables: { tenant: TenantConfig } };

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const override = c.req.header("X-Tenant") ?? url.searchParams.get("tenant") ?? undefined;
  try {
    const tenant = await resolveTenant(url.host, c.env, { tenantOverride: override });
    c.set("tenant", tenant);
  } catch {
    return c.json({ error: "Unknown school" }, 404);
  }
  await next();
});

app.get("/api/tenant", (c) => {
  const { tenantId, name, logoUrl, theme } = c.get("tenant");
  return c.json({ tenantId, name, logoUrl, theme });
});

export default app;
