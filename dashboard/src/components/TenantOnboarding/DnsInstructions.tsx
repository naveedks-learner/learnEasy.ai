import { useState } from "react";

const WORKER_HOST = (import.meta.env.VITE_WORKER_HOSTNAME as string | undefined) ?? "edu-live-worker.workers.dev";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
      }}
    >{done ? "Copied" : "Copy"}</button>
  );
}

export default function DnsInstructions({ domain, onDismiss }: { domain: string; onDismiss: () => void }) {
  const records = [
    { label: "CNAME record", value: `${domain} CNAME ${WORKER_HOST}` },
    { label: "Host", value: domain },
    { label: "Target", value: WORKER_HOST },
  ];
  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">School created. Configure DNS</h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">DNS Pending</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">Add this record at the school's DNS provider. The status stays pending until the domain resolves.</p>
      <ul className="mt-3 space-y-2">
        {records.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-2 rounded bg-white px-3 py-2 text-sm">
            <span><span className="text-slate-500">{r.label}: </span><code>{r.value}</code></span>
            <CopyButton text={r.value} />
          </li>
        ))}
      </ul>
      <button type="button" className="mt-3 text-sm text-slate-600 underline" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
