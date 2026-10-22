import { useEffect, useState } from "react";
import { api, type RuntimeConfig, type TenantConfig } from "../../api/client";

const ENUMS: Record<string, string[]> = {
  webSearchMode: ["auto", "rag_only", "web_only"],
  llmProvider: ["openrouter", "workers-ai"],
  explainRetrievalMode: ["rag_fallback", "rag_plus_llm"],
  answerStyle: ["auto", "short", "detailed"],
};

const TBD_KEYS = new Set(["hardFailNoDocument", "questionPaperModelSlug"]);

function ConfigRow({ k, value, onSave }: { k: string; value: string | number | boolean | null; onSave: (v: string | number | boolean) => Promise<void> }) {
  const [draft, setDraft] = useState<string>(String(value ?? ""));
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setDraft(String(value ?? "")), [value]);
  const save = async (v: string | number | boolean) => {
    try { await onSave(v); setMsg("Saved"); } catch (e) { setMsg((e as Error).message); }
  };
  let control;
  if (typeof value === "boolean") {
    control = <input type="checkbox" className="check" checked={value} onChange={(e) => void save(e.target.checked)} />;
  } else if (ENUMS[k]) {
    control = <select className="input input-auto" value={draft} onChange={(e) => void save(e.target.value)}>{ENUMS[k].map((o) => <option key={o}>{o}</option>)}</select>;
  } else {
    control = (
      <>
        <input className="input input-auto" type={typeof value === "number" ? "number" : "text"} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn btn-secondary btn-sm" onClick={() => void save(typeof value === "number" ? Number(draft) : draft)}>Save</button>
      </>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="mono w-64 text-sm">{k}</span>
      {TBD_KEYS.has(k) ? (
        <span className="badge badge-neutral text-xs" style={{ opacity: 0.7 }}>TBD — not yet wired</span>
      ) : control}
      {msg && !TBD_KEYS.has(k) && <span className="muted text-xs">{msg}</span>}
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
  if (!t) return msg ? <p className="alert alert-error mb-6">{msg}</p> : null;
  const save = async () => {
    try {
      setT(await api.updateTenant(tenantId, { name: t.name, domain: t.domain, theme: t.theme }));
      setMsg("Saved");
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="card mb-6 space-y-4">
      <h3 className="font-semibold">School</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">Name <input className="input mt-1.5 font-normal" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
        <label className="label">Domain <input className="input mt-1.5 font-normal" value={t.domain} onChange={(e) => setT({ ...t, domain: e.target.value })} /></label>
      </div>
      <div className="flex gap-6 text-sm font-semibold">
        <label className="flex items-center gap-2">Primary <input type="color" className="color-input" value={t.theme.primaryColor} onChange={(e) => setT({ ...t, theme: { ...t.theme, primaryColor: e.target.value } })} /></label>
        <label className="flex items-center gap-2">Accent <input type="color" className="color-input" value={t.theme.accentColor} onChange={(e) => setT({ ...t, theme: { ...t.theme, accentColor: e.target.value } })} /></label>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={() => void save()}>Save school</button>
        {msg && <span className="muted text-xs">{msg}</span>}
      </div>
    </section>
  );
}

const MODELS_INFO = [
  { label: "Embedding", model: "@cf/baai/bge-base-en-v1.5", provider: "Workers AI", usage: "Query & document embedding (768-dim)" },
  { label: "Reranker", model: "@cf/baai/bge-reranker-base", provider: "Workers AI", usage: "Cross-encoder reranking of retrieved chunks" },
  { label: "Chat/Explain (free)", model: "@cf/meta/llama-3.1-8b-instruct-fp8", provider: "Workers AI", usage: "Fallback when llmProvider = workers-ai" },
  { label: "Chat/Explain (paid)", model: "Per-tenant llmModelSlug (default: gemini-2.5-flash)", provider: "OpenRouter", usage: "Primary LLM when llmProvider = openrouter" },
  { label: "Evals Judge", model: "openai/gpt-4o-mini", provider: "OpenRouter", usage: "LLM-as-judge for golden-case evaluation" },
  { label: "Enrichment", model: "Per-tenant enrichmentModelSlug", provider: "OpenRouter", usage: "Markdown enrichment during PDF ingestion" },
];

function ModelsCard() {
  return (
    <section className="card mb-6">
      <h3 className="font-semibold mb-3">Models &amp; Infrastructure</h3>
      <div className="overflow-x-auto">
        <table className="table text-sm" style={{ minWidth: 600 }}>
          <thead>
            <tr><th>Role</th><th>Model</th><th>Provider</th><th>Usage</th></tr>
          </thead>
          <tbody>
            {MODELS_INFO.map((m) => (
              <tr key={m.label}>
                <td className="font-medium">{m.label}</td>
                <td className="mono text-xs">{m.model}</td>
                <td>{m.provider}</td>
                <td className="muted">{m.usage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted text-xs mt-3">Vectorize index: learneasy-chunks · Storage: R2 (learneasy-pdfs) · Database: D1 (learneasy-db)</p>
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
      <ModelsCard />
      <h3 className="mb-3 font-semibold">Runtime config</h3>
      {error && <p className="alert alert-error mb-3">{error}</p>}
      <div className="card" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {config && Object.entries(config).map(([k, v]) => (
          <ConfigRow key={k} k={k} value={v} onSave={async (nv) => setConfig(await api.setConfig(tenantId, k, nv))} />
        ))}
      </div>
    </div>
  );
}
