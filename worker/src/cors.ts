import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import type { TenantConfig } from "./tenant";

export function buildCorsHeaders(
  origin: string,
  allowedOrigins: string[],
  adminHostname: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Tenant, x-admin-key, x-ingest-key, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (!origin) return headers;

  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    return headers;
  }

  const allowed =
    allowedOrigins.includes("*") ||
    allowedOrigins.includes(origin) ||
    (adminHostname !== "" && originHost === adminHostname);

  if (allowed) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

type CorsAppEnv = { Bindings: Env; Variables: { tenant: TenantConfig } };

/** Must run after tenant resolution middleware (reads c.get("tenant")). */
export const corsMiddleware: MiddlewareHandler<CorsAppEnv> = async (c, next) => {
  const tenant = c.get("tenant");
  const headers = buildCorsHeaders(
    c.req.header("Origin") ?? "",
    tenant.allowedOrigins,
    c.env.ADMIN_HOSTNAME,
  );
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  await next();
  for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
};
