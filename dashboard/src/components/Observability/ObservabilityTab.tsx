import { useEffect, useState } from "react";
import { api, type Transaction } from "../../api/client";

interface PathStats { path: string; count: number; pct: number }
interface ModelStats { model: string; count: number; avgTokens: number }

function analyze(txns: Transaction[]) {
  const paths: Record<string, number> = {};
  const models: Record<string, { count: number; tokens: number }> = {};
  let totalTokens = 0;
  let withContext = 0;
  let noContext = 0;

  for (const t of txns) {
    const p = t.path_taken ?? "unknown";
    paths[p] = (paths[p] ?? 0) + 1;
    if (p === "rag") withContext++;
    else noContext++;

    const m = t.model ?? "unknown";
    if (!models[m]) models[m] = { count: 0, tokens: 0 };
    models[m].count++;
    models[m].tokens += t.token_estimate ?? 0;
    totalTokens += t.token_estimate ?? 0;
  }

  const total = txns.length || 1;
  const pathStats: PathStats[] = Object.entries(paths)
    .map(([path, count]) => ({ path, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);

  const modelStats: ModelStats[] = Object.entries(models)
    .map(([model, { count, tokens }]) => ({ model, count, avgTokens: Math.round(tokens / count) }))
    .sort((a, b) => b.count - a.count);

  return { total: txns.length, totalTokens, pathStats, modelStats, withContext, noContext, ragRate: Math.round((withContext / total) * 100) };
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 8, borderRadius: 4, background: "var(--border)", flex: 1 }}>
      <div style={{ height: "100%", borderRadius: 4, width: `${Math.max(pct, 2)}%`, background: color, transition: "width 0.3s" }} />
    </div>
  );
}

const PATH_COLORS: Record<string, string> = {
  rag: "var(--success)", web_fallback: "var(--info)", no_context: "var(--warn)", concept_explainer: "var(--primary, #7c5ce0)",
};

const PATH_LABELS: Record<string, string> = {
  rag: "Chat", web_fallback: "Web Fallback", no_context: "Out of Syllabus", concept_explainer: "Concept Explainer",
};

export default function ObservabilityTab({ tenantId }: { tenantId?: string | null }) {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true); setError(null);
    api.transactions(tenantId)
      .then((r) => { if (!cancelled) { setTxns(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [tenantId]);

  if (!tenantId) {
    return (
      <div className="card empty">
        <div className="empty-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        </div>
        <h3 className="font-semibold">Select a school to view analytics</h3>
        <p className="muted text-sm">Pick a school from the dropdown above.</p>
      </div>
    );
  }

  if (error) return <p className="alert alert-error">{error}</p>;
  if (loading) return <p className="muted text-center">Loading…</p>;
  if (txns.length === 0) {
    return (
      <div className="card empty">
        <div className="empty-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 15l4-4 3 3 5-6" /></svg>
        </div>
        <h3 className="font-semibold">No data yet</h3>
        <p className="muted text-sm">Analytics will appear as students use the chatbot.</p>
      </div>
    );
  }

  const stats = analyze(txns);

  return (
    <div className="space-y-4">
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="metric">
          <div className="metric-label">Total queries</div>
          <div className="metric-value">{stats.total.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Total tokens</div>
          <div className="metric-value">{stats.totalTokens >= 1000 ? `${(stats.totalTokens / 1000).toFixed(1)}K` : stats.totalTokens}</div>
        </div>
        <div className="metric">
          <div className="metric-label">RAG success rate</div>
          <div className="metric-value" style={{ color: stats.ragRate >= 70 ? "var(--success)" : stats.ragRate >= 40 ? "var(--warn)" : "var(--error)" }}>
            {stats.ragRate}%
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Avg tokens / query</div>
          <div className="metric-value">{stats.total > 0 ? Math.round(stats.totalTokens / stats.total) : 0}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 className="metric-label mb-3">Pipeline paths</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {stats.pathStats.map((p) => (
            <div key={p.path} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="badge text-xs" style={{
                minWidth: 110, textAlign: "center",
                background: `color-mix(in srgb, ${PATH_COLORS[p.path] ?? "var(--muted)"} 15%, var(--card))`,
                color: PATH_COLORS[p.path] ?? "var(--muted)",
              }}>{PATH_LABELS[p.path] ?? p.path}</span>
              <Bar pct={p.pct} color={PATH_COLORS[p.path] ?? "var(--muted)"} />
              <span className="mono text-xs" style={{ minWidth: 60, textAlign: "right" }}>{p.count} ({p.pct}%)</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 className="metric-label mb-3">Model usage</h3>
        <div className="table-wrap" style={{ boxShadow: "none", border: 0 }}>
          <table className="table">
            <thead><tr><th>Model</th><th>Queries</th><th>Avg tokens</th></tr></thead>
            <tbody>
              {stats.modelStats.map((m) => (
                <tr key={m.model}>
                  <td className="mono text-xs">{m.model}</td>
                  <td className="mono">{m.count}</td>
                  <td className="mono">{m.avgTokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
