import { useEffect, useState } from "react";
import { api, type RuntimeConfig, type TenantConfig } from "../../api/client";

const ENUMS: Record<string, string[]> = {
  webSearchMode: ["auto", "rag_only", "web_only"],
  llmProvider: ["openrouter", "workers-ai"],
  explainRetrievalMode: ["rag_fallback", "rag_plus_llm"],
  answerStyle: ["auto", "short", "detailed"],
};

function ConfigRow({ k, value, onSave }: { k: string; value: string | number | boolean | null; onSave: (v: string | number | boolean) => Promise<void> }) {
  const [draft, setDraft] = useState<string>(String(value ?? ""));
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setDraft(String(value ?? "")), [value]);
  const save = async (v: string | number | boolean) => {
    try { await onSave(v); setMsg("Saved"); } catch (e) { setMsg((e as Error).message); }
  };
  const cls = "rounded border border-slate-300 px-2 py-1 text-sm";
  let control;
  if (typeof value === "boolean") {
    control = <input type="checkbox" checked={value} onChange={(e) => void save(e.target.checked)} />;
  } else if (ENUMS[k]) {
    control = <select className={cls} value={draft} onChange={(e) => void save(e.target.value)}>{ENUMS[k].map((o) => <option key={o}>{o}</option>)}</select>;
  } else {
    control = (
      <>
        <input className={cls} type={typeof value === "number" ? "number" : "text"} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="rounded border px-2 py-1 text-sm" onClick={() => void save(typeof value === "number" ? Number(draft) : draft)}>Save</button>
      </>
    );
  }
  return (
    <div className="flex items-center gap-3 border-b py-2">
      <span className="w-64 font-mono text-sm">{k}</span>{control}
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

function TenantDetails({ tenantId }: { tenantId: string }) {
  const [t, setT] = useState<TenantConfig | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    setT(null); setMsg(null);
    api.listTenants()
      .then((all) => { if (!stale) setT(all.find((x) => x.tenantId === tenantId) ?? null); })
      .catch((e) => { if (!stale) setMsg((e as Error).message); });
    return () => { stale = true; };
  }, [tenantId]);
  if (!t) return msg ? <p className="text-sm text-red-600">{msg}</p> : null;
  const save = async () => {
    try {
      setT(await api.updateTenant(tenantId, { name: t.name, domain: t.domain, theme: t.theme }));
      setMsg("Saved");
    } catch (e) { setMsg((e as Error).message); }
  };
  const cls = "rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <section className="mb-6 space-y-2 rounded-lg border bg-white p-4">
      <h3 className="font-semibold">School</h3>
      <label className="block text-sm">Name <input className={cls} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
      <label className="block text-sm">Domain <input className={cls} value={t.domain} onChange={(e) => setT({ ...t, domain: e.target.value })} /></label>
      <div className="flex gap-4 text-sm">
        <label>Primary <input type="color" value={t.theme.primaryColor} onChange={(e) => setT({ ...t, theme: { ...t.theme, primaryColor: e.target.value } })} /></label>
        <label>Accent <input type="color" value={t.theme.accentColor} onChange={(e) => setT({ ...t, theme: { ...t.theme, accentColor: e.target.value } })} /></label>
      </div>
      <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={() => void save()}>Save school</button>
      {msg && <span className="ml-2 text-xs text-slate-500">{msg}</span>}
    </section>
  );
}

export default function SettingsTab({ tenantId }: { tenantId: string }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setConfig(null); setError(null);
    api.config(tenantId)
      .then((c) => { if (!cancelled) { setConfig(c); setError(null); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [tenantId]);
  return (
    <div>
      <TenantDetails tenantId={tenantId} />
      <h3 className="mb-2 font-semibold">Runtime config</h3>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="rounded-lg border bg-white px-4">
        {config && Object.entries(config).map(([k, v]) => (
          <ConfigRow key={k} k={k} value={v} onSave={async (nv) => setConfig(await api.setConfig(tenantId, k, nv))} />
        ))}
      </div>
    </div>
  );
}
