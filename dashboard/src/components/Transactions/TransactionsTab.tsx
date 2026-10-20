import { Fragment, useEffect, useState } from "react";
import { api, type Transaction } from "../../api/client";

function pretty(s: string | null): string {
  if (!s) return "";
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

export default function TransactionsTab({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows([]); setOpen(null); setError(null);
    api.transactions(tenantId)
      .then((r) => { if (!cancelled) { setRows(r); setError(null); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [tenantId]);

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
                <tr className="row-hover cursor-pointer" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <td className="muted whitespace-nowrap">{t.created_at}</td>
                  <td>{t.path_taken ? <span className="badge badge-info">{t.path_taken}</span> : "–"}</td>
                  <td>{(t.question ?? "").slice(0, 80)}{(t.question?.length ?? 0) > 80 ? "…" : ""}</td>
                  <td className="mono text-xs">{t.model ?? "–"}</td>
                  <td className="mono">{t.token_estimate ?? "–"}</td>
                </tr>
                {open === t.id && (
                  <tr style={{ background: "var(--soft)" }}><td colSpan={5}>
                    <h4 className="metric-label">Answer</h4>
                    <p className="mb-4 mt-1 whitespace-pre-wrap">{t.answer}</p>
                    <h4 className="metric-label">Trace</h4>
                    <pre className="mono mt-1 max-h-96 overflow-auto text-xs">{pretty(t.trace_json)}</pre>
                  </td></tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
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
