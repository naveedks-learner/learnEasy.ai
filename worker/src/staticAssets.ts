import type { Env } from "./env";

const API_PREFIXES = ["/api/", "/admin", "/health"];

function isAdminHost(req: Request, env: Env): boolean {
  if (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "staging") {
    const path = new URL(req.url).pathname;
    return path === "/dashboard" || path.startsWith("/dashboard/");
  }
  return !!env.ADMIN_HOSTNAME && new URL(req.url).host === env.ADMIN_HOSTNAME;
}

/** True for GET/HEAD requests on the admin hostname that are not API calls (i.e. the dashboard SPA). */
export function isAdminStaticRequest(req: Request, env: Env): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!isAdminHost(req, env)) return false;
  const path = new URL(req.url).pathname;
  return !API_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p.endsWith("/") ? p : p + "/"));
}

function withCache(res: Response, path: string): Response {
  const out = new Response(res.body, res);
  const isIndex = path.endsWith("/index.html") || path === "/index.html";
  const isHashed = /\/assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/.test(path);
  out.headers.set("Cache-Control", isHashed ? "public, max-age=31536000, immutable" : isIndex ? "no-cache" : "public, max-age=3600");
  return out;
}

async function fetchAsset(env: Env, req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  url.pathname = path;
  url.search = "";
  return env.ASSETS.fetch(new Request(url.toString(), { method: req.method, headers: req.headers }));
}

/**
 * Serves the SPA for the request hostname: dashboard (built under /dashboard/) on ADMIN_HOSTNAME,
 * student frontend otherwise. Unknown non-file paths fall back to the SPA's index.html.
 */
export async function serveStaticAsset(req: Request, env: Env): Promise<Response> {
  const admin = isAdminHost(req, env);
  const indexPath = admin ? "/dashboard/index.html" : "/index.html";
  let path = new URL(req.url).pathname;
  if (!admin && (path === "/dashboard" || path.startsWith("/dashboard/"))) {
    return new Response("Not found", { status: 404 });
  }
  if (admin && !path.startsWith("/dashboard/")) path = indexPath;
  if (path === "/" || path.endsWith("/")) path += "index.html";

  let res = await fetchAsset(env, req, path);
  if (res.status === 404) {
    const last = path.split("/").pop() ?? "";
    // Missing file (has an extension) is a real 404; extensionless paths are client-side routes.
    if (last.includes(".") && !last.endsWith(".html")) return new Response("Not found", { status: 404 });
    path = indexPath;
    res = await fetchAsset(env, req, path);
  }
  return withCache(res, path);
}
