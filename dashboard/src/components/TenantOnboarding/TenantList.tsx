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

  return (
    <div className="space-y-3">
      <button onClick={onOnboard} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Onboard New School</button>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tenants.map((t) => {
          const s = stats[t.tenantId];
          const active = !!s && s.documentCount > 0;
          return (
            <button key={t.tenantId} onClick={() => onSelect(t.tenantId)}
              className={`rounded-lg border bg-white p-4 text-left hover:shadow ${activeId === t.tenantId ? "border-blue-600 ring-1 ring-blue-600" : "border-slate-200"}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{t.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                  {active ? "active" : "pending"}
                </span>
              </div>
              <div className="text-sm text-slate-500">{t.domain}</div>
              <div className="mt-2 text-xs text-slate-600">
                {s ? `${s.documentCount} docs · last activity ${s.lastActivity ?? "never"}` : "Loading stats…"}
              </div>
            </button>
          );
        })}
        {tenants.length === 0 && <p className="text-sm text-slate-500">No schools yet.</p>}
      </div>
    </div>
  );
}
