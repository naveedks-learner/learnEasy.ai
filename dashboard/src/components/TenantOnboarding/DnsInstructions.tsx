import { useState } from "react";

const WORKER_HOST = (import.meta.env.VITE_WORKER_HOSTNAME as string | undefined) ?? "edu-live-worker.workers.dev";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
      }}
    >{done ? "Copied!" : "Copy"}</button>
  );
}

export default function DnsInstructions({ domain, onDismiss }: { domain: string; onDismiss: () => void }) {
  const records = [
    { label: "Type", value: "CNAME" },
    { label: "Host", value: domain },
    { label: "Target", value: WORKER_HOST },
  ];
  const sub = { background: "var(--soft)", border: "1px solid var(--border)", borderRadius: 16, padding: 18 } as const;
  return (
    <div className="card" style={{ borderColor: "var(--success)" }}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full text-base font-bold" style={{ background: "var(--success-bg)", color: "var(--success)" }}>&#10003;</span>
        <div>
          <h3 className="font-semibold" style={{ color: "var(--success)" }}>School saved successfully!</h3>
          <p className="muted text-sm">The school is registered. Complete the steps below to go live.</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div style={sub}>
          <div className="mb-2 flex items-center gap-2">
            <span className="step">2</span>
            <h4 className="font-semibold">Configure DNS</h4>
            <span className="badge badge-warn badge-dot">pending</span>
          </div>
          <p className="muted mb-3 text-sm">Add this CNAME record at the school's DNS provider so <code className="mono rounded px-1 text-xs" style={{ background: "var(--neutral-bg)" }}>{domain}</code> points to your worker.</p>
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3 text-sm" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 12px" }}>
                <span><span className="muted">{r.label}: </span><code className="mono">{r.value}</code></span>
                <CopyButton text={r.value} />
              </li>
            ))}
          </ul>
        </div>

        <div style={sub}>
          <div className="mb-2 flex items-center gap-2">
            <span className="step">3</span>
            <h4 className="font-semibold">Upload study material</h4>
          </div>
          <p className="muted text-sm">Go to the <strong style={{ color: "var(--text)" }}>Documents</strong> tab, select this school, and upload PDFs. The chatbot can only answer questions from uploaded material.</p>
        </div>

        <div style={{ ...sub, opacity: 0.65 }}>
          <div className="mb-2 flex items-center gap-2">
            <span className="step step-off">4</span>
            <h4 className="font-semibold muted">Share with students</h4>
          </div>
          <p className="muted text-sm">Once DNS is live and documents are uploaded, students can visit <code className="mono rounded px-1 text-xs" style={{ background: "var(--neutral-bg)" }}>{domain}</code> to start asking questions.</p>
        </div>
      </div>

      <button type="button" className="btn btn-secondary mt-5" onClick={onDismiss}>
        Done — back to school list
      </button>
    </div>
  );
}
