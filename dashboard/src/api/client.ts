export interface TenantConfig {
  tenantId: string;
  name: string;
  logoUrl: string;
  theme: { primaryColor: string; accentColor: string; fontFamily?: string };
  allowedOrigins: string[];
  domain: string;
  features: { conceptExplainerEnabled: boolean; questionPaperEnabled: boolean; webSearchEnabled: boolean };
  rateLimits: { chatRequestsPerMinute: number; ingestMaxFileSizeMb: number };
}
export interface TenantStats { tenantId: string; documentCount: number; transactionCount: number; lastActivity: string | null }
export interface DocumentInfo {
  name: string; size: number; uploaded: string;
  chunkCount: number | null; pageCount: number | null; indexedAt: string | null; enriched: boolean;
}
export interface Transaction {
  id: number; tenant_id: string; path_taken: string | null; question: string | null; answer: string | null;
  model: string | null; provider: string | null; trace_json: string | null; token_estimate: number | null; created_at: string;
}
export interface Costing {
  totalRequests: number; totalTokens: number;
  breakdown: Array<{ provider: string | null; model: string | null; requests: number; tokens: number }>;
}
export type RuntimeConfig = Record<string, string | number | boolean | null>;

const KEY_STORAGE = "learneasy.adminKey";
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export function getAdminKey(): string | null {
  try { return localStorage.getItem(KEY_STORAGE); } catch { return null; }
}
export function setAdminKey(key: string): void {
  try { localStorage.setItem(KEY_STORAGE, key); } catch { /* ignore */ }
}
export function clearAdminKey(): void {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "x-admin-key": getAdminKey() ?? "" };
  if (typeof init.body === "string") headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

const q = (tenantId: string) => `tenant_id=${encodeURIComponent(tenantId)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  listTenants: () => request<{ tenants: TenantConfig[] }>("/admin/tenants").then((r) => r.tenants),
  createTenant: (t: Partial<TenantConfig>) => request<{ tenant: TenantConfig }>("/admin/tenants", json("POST", t)).then((r) => r.tenant),
  updateTenant: (id: string, t: Partial<TenantConfig>) =>
    request<{ tenant: TenantConfig }>(`/admin/tenants/${encodeURIComponent(id)}`, json("PUT", t)).then((r) => r.tenant),
  deleteTenant: (id: string) => request<{ ok: true }>(`/admin/tenants/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tenantStats: (id: string) => request<TenantStats>(`/admin/tenants/${encodeURIComponent(id)}/stats`),
  documents: (id: string) => request<{ documents: DocumentInfo[] }>(`/admin/documents?${q(id)}`).then((r) => r.documents),
  cleaned: (id: string, name: string) =>
    request<{ name: string; text: string }>(`/admin/documents/cleaned?${q(id)}&name=${encodeURIComponent(name)}`),
  documentChunks: (id: string, name: string) =>
    request<{ name: string; chunks: Array<{ text: string; startPage: number; endPage: number; chunkIndex: number }> }>(
      `/admin/documents/chunks?${q(id)}&name=${encodeURIComponent(name)}`,
    ),
  transactions: (id: string, since?: string) =>
    request<{ transactions: Transaction[] }>(`/admin/transactions?${q(id)}${since ? `&since=${encodeURIComponent(since)}` : ""}`).then((r) => r.transactions),
  costing: (id: string, since?: string) =>
    request<Costing>(`/admin/costing?${q(id)}${since ? `&since=${encodeURIComponent(since)}` : ""}`),
  config: (id: string) => request<{ config: RuntimeConfig }>(`/admin/config?${q(id)}`).then((r) => r.config),
  setConfig: (id: string, key: string, value: string | number | boolean) =>
    request<{ config: RuntimeConfig }>(`/admin/config?${q(id)}`, json("PUT", { key, value })).then((r) => r.config),
  /** Ingest a PDF for a tenant via the X-Tenant override (honoured by the worker in development mode only). */
  ingest: async (id: string, file: File, ingestKey: string, force = false) => {
    const form = new FormData();
    form.append("file", file);
    if (force) form.append("force", "true");
    const res = await fetch(`${BASE}/api/ingest?tenant=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "x-ingest-key": ingestKey, "x-admin-key": getAdminKey() ?? "", "X-Tenant": id },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Ingest failed (${res.status})`);
    return data;
  },
};
