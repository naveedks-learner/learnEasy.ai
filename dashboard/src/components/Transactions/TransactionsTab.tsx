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
    setRows([]); setOpen(null);
    api.transactions(tenantId).then((r) => { setRows(r); setError(null); }).catch((e) => setError((e as Error).message));
  }, [tenantId]);

  return (
    <div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <table className="w-full bg-white text-left text-sm">
        <thead className="border-b text-slate-500"><tr>
          <th className="p-2">Time</th><th className="p-2">Path</th><th className="p-2">Question</th><th className="p-2">Model</th><th className="p-2">Tokens</th>
        </tr></thead>
        <tbody>
          {rows.map((t) => (
            <Fragment key={t.id}>
              <tr className="cursor-pointer border-b hover:bg-slate-50" onClick={() => setOpen(open === t.id ? null : t.id)}>
                <td className="p-2 whitespace-nowrap">{t.created_at}</td><td className="p-2">{t.path_taken ?? "–"}</td>
                <td className="p-2">{(t.question ?? "").slice(0, 80)}{(t.question?.length ?? 0) > 80 ? "…" : ""}</td>
                <td className="p-2">{t.model ?? "–"}</td><td className="p-2">{t.token_estimate ?? "–"}</td>
              </tr>
              {open === t.id && (
                <tr className="border-b bg-slate-50"><td colSpan={5} className="p-3">
                  <h4 className="font-semibold">Answer</h4>
                  <p className="mb-2 whitespace-pre-wrap">{t.answer}</p>
                  <h4 className="font-semibold">Trace</h4>
                  <pre className="max-h-96 overflow-auto text-xs">{pretty(t.trace_json)}</pre>
                </td></tr>
              )}
            </Fragment>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="p-3 text-slate-500">No transactions.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
