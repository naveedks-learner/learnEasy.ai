import { Fragment, useEffect, useState } from "react";
import { api, type Transaction } from "../../api/client";

interface TraceChunk {
  text?: string;
  score?: number;
  rerankScore?: number;
  jevScore?: number;
  kept?: boolean;
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

function ChunkRow({ c, i }: { c: TraceChunk; i: number }) {
  const [showText, setShowText] = useState(false);
  return (
    <div className={`chunk-row ${c.kept ? "" : "chunk-discarded"}`}>
      <div className="chunk-header">
        <span className="chunk-idx">#{i + 1}</span>
        <span className="mono text-xs">{c.filename ?? "unknown"}</span>
        {(c.page != null || c.startPage != null) && (
          <span className="muted text-xs">p.{c.page ?? c.startPage}</span>
        )}
        <span className={`badge ${c.kept ? "badge-success" : "badge-neutral"} text-xs`} style={{ marginLeft: "auto" }}>
          {c.kept ? "kept" : "discarded"}
        </span>
      </div>
      <div className="chunk-scores">
        <span title="Cosine similarity">cos: {(c.score ?? 0).toFixed(3)}</span>
        {c.rerankScore != null && <span title="Rerank score">rerank: {c.rerankScore.toFixed(3)}</span>}
        {c.jevScore != null && <span title="JEV score">jev: {Number(c.jevScore).toFixed(2)}</span>}
      </div>
      <button type="button" className="chunk-toggle" onClick={() => setShowText(!showText)}>
        {showText ? "Hide text ▴" : "Show text ▾"}
      </button>
      {showText && <pre className="chunk-text">{c.text ?? "(empty)"}</pre>}
    </div>
  );
}

function PipelineDetail({ t }: { t: Transaction }) {
  const trace = parseTrace(t.trace_json);
  const chunks = trace?.chunks ?? [];
  const keptChunks = chunks.filter((c) => c.kept);
  const webResults = trace?.webResults ?? [];
  const path = t.path_taken ?? "unknown";

  return (
    <div className="pipeline">
      <div className="pipeline-summary">
        <div className="kv"><span className="kv-label">Path</span><span className="badge badge-info">{path}</span></div>
        <div className="kv"><span className="kv-label">Model</span><span className="mono text-xs">{t.model ?? "–"}</span></div>
        <div className="kv"><span className="kv-label">Tokens</span><span className="mono text-xs">{t.token_estimate ?? "–"}</span></div>
        {trace?.answerStyle && <div className="kv"><span className="kv-label">Style</span><span>{trace.answerStyle}</span></div>}
      </div>

      {/* Retrieval */}
      {chunks.length > 0 && (
        <details className="stage">
          <summary className="stage-head">
            <span className="stage-num" style={{ background: "var(--success)" }}>1</span>
            <span className="stage-label">Retrieval & Ranking ({chunks.length} chunks → {keptChunks.length} kept)</span>
          </summary>
          <div className="stage-body">
            <div className="chunks-list">
              {chunks.map((c, i) => <ChunkRow key={i} c={c} i={i} />)}
            </div>
          </div>
        </details>
      )}

      {/* Web fallback */}
      {webResults.length > 0 && (
        <details className="stage">
          <summary className="stage-head">
            <span className="stage-num" style={{ background: "var(--info)" }}>2</span>
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

      {/* Answer */}
      <details className="stage" open>
        <summary className="stage-head">
          <span className="stage-num" style={{ background: t.answer ? "var(--success)" : "var(--error)" }}>{webResults.length > 0 ? 3 : 2}</span>
          <span className="stage-label">LLM Answer ({t.token_estimate ?? "?"} tokens)</span>
        </summary>
        <div className="stage-body">
          <pre className="chunk-text" style={{ maxHeight: 300 }}>{t.answer ?? "(none)"}</pre>
        </div>
      </details>
    </div>
  );
}

export default function TransactionsTab({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows([]); setOpenId(null); setError(null); setLoading(true);
    api.transactions(tenantId)
      .then((r) => { if (!cancelled) { setRows(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [tenantId]);

  if (loading) return <p className="muted text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      {error && <p className="alert alert-error">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>Time</th><th>Path</th><th>Question</th><th>Model</th><th>Tokens</th>
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <Fragment key={t.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{t.created_at}</td>
                  <td>{t.path_taken ? <span className="badge badge-info">{t.path_taken}</span> : "–"}</td>
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
