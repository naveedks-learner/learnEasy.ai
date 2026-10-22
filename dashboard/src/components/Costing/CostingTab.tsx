import { useEffect, useState } from "react";
import { api, type Costing } from "../../api/client";
import PeriodSelector, { type Period, sinceFromPeriod } from "../PeriodSelector";

const PRICING: Record<string, { input: number; output: number; label: string }> = {
  "google/gemini-2.5-flash": { input: 0.30, output: 2.50, label: "Gemini 2.5 Flash" },
  "google/gemini-2.5-pro": { input: 1.25, output: 10, label: "Gemini 2.5 Pro" },
  "openai/gpt-4o-mini": { input: 0.165, output: 0.66, label: "GPT-4o Mini" },
  "openai/gpt-4o": { input: 2.5, output: 10, label: "GPT-4o" },
  "qwen/qwen3-235b-a22b:free": { input: 0, output: 0, label: "Qwen3 235B (free)" },
  "meta-llama/llama-3.1-8b-instruct:free": { input: 0, output: 0, label: "Llama 3.1 8B (free)" },
  "@cf/baai/bge-base-en-v1.5": { input: 0, output: 0, label: "BGE Base (Workers AI)" },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { input: 0, output: 0, label: "Llama 3.1 (Workers AI)" },
};

function estimateCost(model: string | null, inputTokens: number, outputTokens: number, totalTokens: number): number {
  const p = PRICING[model ?? ""];
  if (!p) return (totalTokens / 1_000_000) * 0.30;
  if (inputTokens > 0 || outputTokens > 0) {
    return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  }
  const avgRate = (p.input + p.output) / 2;
  return (totalTokens / 1_000_000) * avgRate;
}

function fmt$(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export default function CostingTab({ tenantId }: { tenantId?: string | null }) {
  const [data, setData] = useState<Costing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("");

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setData(null); setError(null);
    api.costing(tenantId, sinceFromPeriod(period))
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [tenantId, period]);

  if (!tenantId) {
    return (
      <div className="card empty">
        <div className="empty-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" /></svg>
        </div>
        <h3 className="font-semibold">Select a school to view costs</h3>
        <p className="muted text-sm">Pick a school from the dropdown above.</p>
      </div>
    );
  }

  if (error) return <p className="alert alert-error">{error}</p>;
  if (!data) return <p className="muted text-center">Loading…</p>;

  const totalCost = data.breakdown.reduce((s, r) => s + estimateCost(r.model, r.input_tokens, r.output_tokens, r.tokens), 0);
  const hasBreakdown = data.totalInputTokens > 0 || data.totalOutputTokens > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-semibold text-lg">Costing</h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: `repeat(${hasBreakdown ? 5 : 3}, 1fr)` }}>
        <div className="metric">
          <div className="metric-label">Total requests</div>
          <div className="metric-value">{data.totalRequests.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Total tokens</div>
          <div className="metric-value">{fmtTokens(data.totalTokens)}</div>
        </div>
        {hasBreakdown && (
          <>
            <div className="metric">
              <div className="metric-label">Input tokens</div>
              <div className="metric-value">{fmtTokens(data.totalInputTokens)}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Output tokens</div>
              <div className="metric-value">{fmtTokens(data.totalOutputTokens)}</div>
            </div>
          </>
        )}
        <div className="metric">
          <div className="metric-label">Estimated cost</div>
          <div className="metric-value">{fmt$(totalCost)}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>Model</th><th>Provider</th><th>Requests</th>
            <th>Tokens</th>
            {hasBreakdown && <><th>Input</th><th>Output</th></>}
            <th>Input rate</th><th>Output rate</th><th>Est. cost</th>
          </tr></thead>
          <tbody>
            {data.breakdown.map((r, i) => {
              const p = PRICING[r.model ?? ""];
              const cost = estimateCost(r.model, r.input_tokens, r.output_tokens, r.tokens);
              return (
                <tr key={i}>
                  <td>
                    <span className="font-semibold text-sm">{p?.label ?? r.model ?? "–"}</span>
                    {r.model && <span className="mono text-xs muted block">{r.model}</span>}
                  </td>
                  <td className="text-sm">{r.provider ?? "–"}</td>
                  <td className="mono">{r.requests.toLocaleString()}</td>
                  <td className="mono">{fmtTokens(r.tokens)}</td>
                  {hasBreakdown && (
                    <>
                      <td className="mono">{r.input_tokens > 0 ? fmtTokens(r.input_tokens) : "–"}</td>
                      <td className="mono">{r.output_tokens > 0 ? fmtTokens(r.output_tokens) : "–"}</td>
                    </>
                  )}
                  <td className="mono text-xs">{p ? `$${p.input}/M` : "–"}</td>
                  <td className="mono text-xs">{p ? `$${p.output}/M` : "–"}</td>
                  <td className="mono font-semibold">{fmt$(cost)}</td>
                </tr>
              );
            })}
            {data.breakdown.length === 0 && (
              <tr><td colSpan={hasBreakdown ? 9 : 7}>
                <div className="empty">
                  <p className="font-semibold">No usage data yet</p>
                  <p className="muted text-sm">Costs will appear as students use the chatbot.</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h4 className="metric-label mb-2">Pricing reference (OpenRouter, per 1M tokens)</h4>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {Object.entries(PRICING).filter(([, v]) => v.input > 0 || v.output > 0).map(([slug, p]) => (
            <div key={slug} className="text-xs" style={{ background: "var(--soft)", borderRadius: 10, padding: "8px 12px" }}>
              <div className="font-semibold">{p.label}</div>
              <div className="muted mono">${p.input}/M in · ${p.output}/M out</div>
            </div>
          ))}
          <div className="text-xs" style={{ background: "var(--soft)", borderRadius: 10, padding: "8px 12px" }}>
            <div className="font-semibold">Workers AI / Free models</div>
            <div className="muted mono">$0 (included in plan)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
