import type { Env } from "./env";
import { loadConfig } from "./config";

export interface RetentionSummary {
  tenantsProcessed: number;
  transactionsDeleted: number;
  rateLimitsDeleted: number;
}

/**
 * Deletes expired transactions per tenant (per its dataRetentionDays) and stale rate-limit windows.
 * Fail-open per tenant: a D1 error is logged and the next tenant is still processed.
 */
export async function cleanupExpiredData(env: Env): Promise<RetentionSummary> {
  const summary: RetentionSummary = { tenantsProcessed: 0, transactionsDeleted: 0, rateLimitsDeleted: 0 };

  let tenantIds: string[];
  try {
    const { results } = await env.DB.prepare("SELECT tenant_id FROM tenants").all<{ tenant_id: string }>();
    tenantIds = (results ?? []).map((r) => r.tenant_id);
  } catch (err) {
    console.error("retention: failed to list tenants", err);
    return summary;
  }

  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 16);

  for (const tenantId of tenantIds) {
    try {
      const config = await loadConfig(tenantId, env.DB);
      const days = Math.floor(config.dataRetentionDays);
      if (Number.isFinite(days) && days >= 1) {
        const tx = await env.DB.prepare(
          `DELETE FROM transactions WHERE tenant_id = ? AND created_at < datetime('now', '-${days} days')`,
        )
          .bind(tenantId)
          .run();
        summary.transactionsDeleted += tx.meta?.changes ?? 0;
      }
      const rl = await env.DB.prepare("DELETE FROM rate_limits WHERE tenant_id = ? AND window < ?")
        .bind(tenantId, cutoff)
        .run();
      summary.rateLimitsDeleted += rl.meta?.changes ?? 0;
      summary.tenantsProcessed++;
    } catch (err) {
      console.error(`retention: cleanup failed for tenant ${tenantId}`, err);
    }
  }
  return summary;
}
