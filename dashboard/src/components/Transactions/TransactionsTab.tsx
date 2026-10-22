import { Fragment, useEffect, useState } from "react";
import { api, type Transaction } from "../../api/client";
import PeriodSelector, { type Period, sinceFromPeriod } from "../PeriodSelector";

function toIST(utc: string | null): string {
  if (!utc) return "–";
  try {
    const d = new Date(utc.endsWith("Z") ? utc : utc + "Z");
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
  } catch { return utc; }
}

interface TraceChunk {
  text?: string;
  score?: number;
  rerankScore?: number;
  jevScore?: number;
  kept?: boolean;
  chunkIndex?: number;
  filename?: string;
  page?: number;
  startPage?: number;
  [k: string]: unknown;
}

interface TraceData {
  chunks?: TraceChunk[];
  answerStyle?: string;
  webResults?: Array<{ title?: string; url?: string; snippet?: string }>;
  explainRetrievalMode?: string;
  groundedIn?: string;
}

function parseTrace(raw: string | null): TraceData | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as TraceData; } catch { return null; }
}

function ChunksTable({ chunks }: { chunks: TraceChunk[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  return (
    <div className="table-wrap">
      <table className="table text-xs">
        <thead><tr>
          <th>Rank</th><th>Source</th><th>Page</th><th>Chunk</th><th>Cosine</th>
          <th>Rerank</th><th>JEV</th><th>Status</th>
        </tr></thead>
        <tbody>
          {chunks.map((c, i) => (
            <Fragment key={i}>
              <tr style={{ cursor: "pointer" }} onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}>
                <td className="mono">{i + 1}</td>
                <td className="mono">{c.filename ?? "unknown"}</td>
                <td className="mono">{c.page ?? c.startPage ?? "–"}</td>
                <td className="mono">{c.chunkIndex ?? i}</td>
                <td className="mono">{(c.score ?? 0).toFixed(4)}</td>
                <td className="mono">{c.rerankScore != null ? Number(c.rerankScore).toFixed(4) : "–"}</td>
                <td className="mono">{c.jevScore != null ? Number(c.jevScore).toFixed(2) : "–"}</td>
                <td><span className={`badge ${c.kept ? "badge-success" : "badge-neutral"}`}>{c.kept ? "kept" : "discarded"}</span></td>
              </tr>
              {expandedIdx === i && (
                <tr><td colSpan={8} style={{ padding: 0, border: 0 }}>
                  <pre className="chunk-text" style={{ margin: 8 }}>{c.text ?? "(empty)"}</pre>
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipelineDetail({ t }: { t: Transaction }) {
  const trace = parseTrace(t.trace_json);
  const chunks = trace?.chunks ?? [];
  const keptChunks = chunks.filter((c) => c.kept);
  const webResults = trace?.webResults ?? [];
  const path = t.path_taken ?? "unknown";

  const contextBlocks = [
    ...keptChunks.map((c, i) => `[Document ${i + 1}: ${c.filename ?? "unknown"}]\n${(c.text ?? "").slice(0, 300)}…`),
    ...webResults.map((r, i) => `[Web ${i + 1}: ${r.title} (${r.url})]\n${r.snippet ?? ""}`),
  ];
  const modelInput = contextBlocks.length > 0
    ? `Context:\n${contextBlocks.join("\n\n")}\n\nQuestion: ${t.question ?? ""}`
    : `(no context)\n\nQuestion: ${t.question ?? ""}`;

  let stageNum = 0;

  return (
    <div className="pipeline">
      <div className="pipeline-summary">
        <div className="kv"><span className="kv-label">Path</span><span className="badge badge-info">{{ rag: "Chat", no_context: "Out of Syllabus", concept_explainer: "Explainer", web_fallback: "Web Fallback" }[path] ?? path}</span></div>
        <div className="kv"><span className="kv-label">Model</span><span className="mono text-xs">{t.model ?? "–"}</span></div>
        <div className="kv"><span className="kv-label">Tokens</span><span className="mono text-xs">{t.token_estimate ?? "–"}{t.input_tokens != null && t.output_tokens != null ? ` (in: ${t.input_tokens}, out: ${t.output_tokens})` : ""}</span></div>
        {trace?.answerStyle && <div className="kv"><span className="kv-label">Style</span><span>{trace.answerStyle}</span></div>}
        {trace?.groundedIn && <div className="kv"><span className="kv-label">Grounded in</span><span>{trace.groundedIn}</span></div>}
        {trace?.explainRetrievalMode && <div className="kv"><span className="kv-label">Retrieval mode</span><span>{trace.explainRetrievalMode}</span></div>}
      </div>

      {/* Stage 1: VectorDB Retrieval */}
      {chunks.length > 0 && (
        <details className="stage">
          <summary className="stage-head">
            <span className="stage-num" style={{ background: "var(--secondary)" }}>{++stageNum}</span>
            <span className="stage-label">VectorDB Retrieval & Ranking ({chunks.length} chunks → {keptChunks.length} kept)</span>
          </summary>
          <div className="stage-body">
            <ChunksTable chunks={chunks} />
          </div>
        </details>
      )}

      {/* Stage 2: Web fallback */}
      {webResults.length > 0 && (
        <details className="stage">
          <summary className="stage-head">
            <span className="stage-num" style={{ background: "var(--info)" }}>{++stageNum}</span>
            <span className="stage-label">Web Fallback ({webResults.length} results)</span>
          </summary>
          <div className="stage-body">
            {webResults.map((w, i) => (
              <div key={i} className="web-result">
                <strong className="text-xs">{w.title}</strong>
                {w.url && <a href={w.url} target="_blank" rel="noopener noreferrer" className="mono text-xs muted">{w.url}</a>}
                {w.snippet && <p className="text-xs muted">{w.snippet}</p>}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Stage 3: Model I/O */}
      <details className="stage" open>
        <summary className="stage-head">
          <span className="stage-num" style={{ background: t.answer ? "var(--success)" : "var(--error)" }}>{++stageNum}</span>
          <span className="stage-label">LLM Generation — {t.model ?? "unknown"} ({t.token_estimate ?? "?"} tokens)</span>
        </summary>
        <div className="stage-body">
          <div className="stage-io">
            <div className="io-block">
              <div className="io-label">Input (context + question)</div>
              <pre className="io-text chunk-text" style={{ maxHeight: 200 }}>{modelInput}</pre>
            </div>
            <div className="io-arrow">→</div>
            <div className="io-block">
              <div className="io-label">Output (LLM answer)</div>
              <pre className="io-text chunk-text" style={{ maxHeight: 200 }}>{t.answer ?? "(none)"}</pre>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

function SummaryCards({ rows }: { rows: Transaction[] }) {
  const total = rows.length;
  const totalTokens = rows.reduce((s, r) => s + (r.token_estimate ?? 0), 0);
  const ragCount = rows.filter((r) => r.path_taken === "rag").length;
  const ragRate = total > 0 ? Math.round((ragCount / total) * 100) : 0;
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
      <div className="metric">
        <div className="metric-label">Queries</div>
        <div className="metric-value">{total.toLocaleString()}</div>
      </div>
      <div className="metric">
        <div className="metric-label">Total tokens</div>
        <div className="metric-value">{totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : totalTokens}</div>
      </div>
      <div className="metric">
        <div className="metric-label">RAG rate</div>
        <div className="metric-value" style={{ color: ragRate >= 70 ? "var(--success)" : ragRate >= 40 ? "var(--warn)" : "var(--error)" }}>{ragRate}%</div>
      </div>
      <div className="metric">
        <div className="metric-label">Avg tokens</div>
        <div className="metric-value">{total > 0 ? Math.round(totalTokens / total) : 0}</div>
      </div>
    </div>
  );
}

export default function TransactionsTab({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>("");

  useEffect(() => {
    let cancelled = false;
    setRows([]); setOpenId(null); setError(null); setLoading(true);
    api.transactions(tenantId, sinceFromPeriod(period))
      .then((r) => { if (!cancelled) { setRows(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [tenantId, period]);

  if (loading) return <p className="muted text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-semibold text-lg">Transactions</h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      <SummaryCards rows={rows} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>Time</th><th>Path</th><th>Question</th><th>Model</th><th>Tokens</th>
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <Fragment key={t.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{toIST(t.created_at)}</td>
                  <td>{t.path_taken ? <span className="badge badge-info">{{ rag: "Chat", no_context: "Out of Syllabus", concept_explainer: "Explainer", web_fallback: "Web Fallback" }[t.path_taken] ?? t.path_taken}</span> : "–"}</td>
                  <td>{(t.question ?? "").slice(0, 80)}{(t.question?.length ?? 0) > 80 ? "…" : ""}</td>
                  <td className="mono text-xs">{t.model ?? "–"}</td>
                  <td className="mono">{t.token_estimate ?? "–"}</td>
                </tr>
                {openId === t.id && (
                  <tr><td colSpan={5} style={{ padding: 0, border: 0 }}>
                    <PipelineDetail t={t} />
                  </td></tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={5}>
                <div className="empty">
                  <p className="font-semibold">No transactions yet</p>
                  <p className="muted text-sm">Student questions and answers will be logged here.</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
