import type { Env } from "./env";

export interface TenantTheme {
  primaryColor: string;
  accentColor: string;
  fontFamily?: string;
}

export interface TenantFeatures {
  conceptExplainerEnabled: boolean;
  questionPaperEnabled: boolean;
  webSearchEnabled: boolean;
}

export interface TenantRateLimits {
  chatRequestsPerMinute: number;
  ingestMaxFileSizeMb: number;
}

export interface TenantConfig {
  tenantId: string;
  name: string;
  logoUrl: string;
  theme: TenantTheme;
  allowedOrigins: string[];
  domain: string;
  features: TenantFeatures;
  rateLimits: TenantRateLimits;
}

export const DEFAULT_THEME: TenantTheme = {
  primaryColor: "#2563eb",
  accentColor: "#1e40af",
};

export const DEFAULT_FEATURES: TenantFeatures = {
  conceptExplainerEnabled: true,
  questionPaperEnabled: true,
  webSearchEnabled: true,
};

export const DEFAULT_RATE_LIMITS: TenantRateLimits = {
  chatRequestsPerMinute: 30,
  ingestMaxFileSizeMb: 50,
};

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== typeof fallback) return fallback;
    if (Array.isArray(fallback) !== Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function tenantFromRow(row: Record<string, unknown>): TenantConfig {
  const theme = parseJson<Partial<TenantTheme>>(row.theme_json, {});
  const features = parseJson<Partial<TenantFeatures>>(row.features_json, {});
  const rateLimits = parseJson<Partial<TenantRateLimits>>(row.rate_limits_json, {});
  return {
    tenantId: String(row.tenant_id),
    name: String(row.name),
    domain: String(row.domain),
    logoUrl: typeof row.logo_url === "string" ? row.logo_url : "",
    theme: { ...DEFAULT_THEME, ...theme },
    allowedOrigins: parseJson<string[]>(row.allowed_origins_json, []),
    features: { ...DEFAULT_FEATURES, ...features },
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...rateLimits },
  };
}

export interface ResolveTenantOptions {
  /** Honoured only when env.ENVIRONMENT === "development". */
  tenantOverride?: string;
}

/** The one function that maps hostname -> tenant. Throws "Unknown tenant" if none matches. */
export async function resolveTenant(
  hostname: string,
  env: Env,
  opts: ResolveTenantOptions = {},
): Promise<TenantConfig> {
  const useOverride = env.ENVIRONMENT === "development" && !!opts.tenantOverride;
  const row = useOverride
    ? await env.DB.prepare("SELECT * FROM tenants WHERE tenant_id = ?")
        .bind(opts.tenantOverride)
        .first<Record<string, unknown>>()
    : await env.DB.prepare("SELECT * FROM tenants WHERE domain = ?")
        .bind(hostname)
        .first<Record<string, unknown>>();
  if (!row) throw new Error("Unknown tenant");
  return tenantFromRow(row);
}
