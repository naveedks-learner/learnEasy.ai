export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/** Fixed per-minute window counter in D1. Fail-open: any D1 error allows the request. */
export async function checkRateLimit(
  tenantId: string,
  limit: number,
  db: D1Database,
): Promise<RateLimitResult> {
  try {
    const window = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    const row = await db
      .prepare("SELECT count FROM rate_limits WHERE tenant_id = ? AND window = ?")
      .bind(tenantId, window)
      .first<{ count: number }>();
    const count = row?.count ?? 0;
    if (count >= limit) return { allowed: false, remaining: 0 };
    await db
      .prepare(
        "INSERT INTO rate_limits (tenant_id, window, count) VALUES (?, ?, 1) ON CONFLICT(tenant_id, window) DO UPDATE SET count = count + 1",
      )
      .bind(tenantId, window)
      .run();
    return { allowed: true, remaining: limit - count - 1 };
  } catch (err) {
    console.error("[rateLimit] D1 error, failing open:", String(err));
    return { allowed: true, remaining: -1 };
  }
}
