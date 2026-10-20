import { useEffect, useState } from "react";
import { api, type TenantConfig, type TenantStats } from "../../api/client";

export default function TenantList({ tenants, activeId, onSelect, onOnboard }: {
  tenants: TenantConfig[]; activeId: string | null; onSelect: (id: string) => void; onOnboard: () => void;
}) {
  const [stats, setStats] = useState<Record<string, TenantStats>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(tenants.map((t) => api.tenantStats(t.tenantId).catch(() => null))).then((all) => {
      if (cancelled) return;
      const next: Record<string, TenantStats> = {};
      all.forEach((s) => { if (s) next[s.tenantId] = s; });
      setStats(next);
    });
    return () => { cancelled = true; };
  }, [tenants]);

  const getStatus = (s: TenantStats | undefined) => {
    if (!s) return { label: "loading…", cls: "badge-neutral" };
    if (s.documentCount > 0 && s.transactionCount > 0) return { label: "active", cls: "badge-success badge-dot" };
    if (s.documentCount > 0) return { label: "ready", cls: "badge-info badge-dot" };
    return { label: "needs setup", cls: "badge-warn badge-dot" };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Schools</h3>
          <p className="muted text-sm">{tenants.length} school{tenants.length !== 1 ? "s" : ""} registered</p>
        </div>
        <button onClick={onOnboard} className="btn btn-primary">+ Add School</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tenants.map((t) => {
          const s = stats[t.tenantId];
          const status = getStatus(s);
          const selected = activeId === t.tenantId;
          return (
            <button key={t.tenantId} onClick={() => onSelect(t.tenantId)}
              className="card card-hover text-left"
              style={selected ? { borderColor: "var(--primary)", boxShadow: "0 0 0 3px var(--ring)" } : undefined}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{t.name}</span>
                <span className={`badge ${status.cls}`}>{status.label}</span>
              </div>
              <div className="muted mt-1 text-sm">{t.domain}</div>
              <div className="mt-4 flex items-center gap-2 text-xs" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <span className="muted">
                  {s ? `${s.documentCount} doc${s.documentCount !== 1 ? "s" : ""} · last activity ${s.lastActivity ?? "never"}` : "Loading…"}
                </span>
              </div>
            </button>
          );
        })}
        {tenants.length === 0 && (
          <div className="card empty col-span-full" style={{ borderStyle: "dashed" }}>
            <div className="empty-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" /></svg>
            </div>
            <p className="font-semibold">No schools yet</p>
            <p className="muted text-sm">Click <strong>+ Add School</strong> to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
