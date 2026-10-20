import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DocumentInfo } from "../../api/client";

const INGEST_KEY_STORAGE = "learneasy.ingestKey";

export default function DocumentsTab({ tenantId }: { tenantId: string }) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [modal, setModal] = useState<{ name: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback((isCancelled: () => boolean = () => false) => {
    api.documents(tenantId)
      .then((d) => { if (!isCancelled()) { setDocs(d); setError(null); } })
      .catch((e) => { if (!isCancelled()) setError((e as Error).message); });
  }, [tenantId]);
  useEffect(() => {
    let cancelled = false;
    setDocs([]); setError(null); setStatus(null);
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    let key: string | null = null;
    try { key = localStorage.getItem(INGEST_KEY_STORAGE); } catch { /* ignore */ }
    if (!key) {
      key = window.prompt("Ingest API key");
      if (!key) return;
      try { localStorage.setItem(INGEST_KEY_STORAGE, key); } catch { /* ignore */ }
    }
    setStatus(`Uploading ${file.name}…`);
    setUploading(true);
    try {
      await api.ingest(tenantId, file, key);
      setStatus(`Indexed ${file.name}`);
      load();
    } catch (e) {
      setStatus(`Upload failed: ${(e as Error).message}`);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const view = async (name: string) => {
    try { setModal(await api.cleaned(tenantId, name)); } catch (e) { setError((e as Error).message); }
  };

  const failed = status?.startsWith("Upload failed");

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
      <div
        className={`dropzone ${dragging ? "dropzone-active" : ""}`}
        role="button" tabIndex={0}
        onClick={() => { if (!uploading) fileRef.current?.click(); }}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !uploading) fileRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!uploading) void upload(e.dataTransfer.files?.[0]); }}
      >
        <div className="empty-icon mx-auto">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        </div>
        <p className="font-semibold">Drop a PDF here, or click to browse</p>
        <p className="muted mt-1 text-sm">Study material is chunked, embedded and indexed for this school.</p>
        {uploading && <div className="progress mx-auto mt-4 max-w-xs"><span /></div>}
        {status && (
          <p className="mt-3 text-sm font-medium" style={{ color: failed ? "var(--error)" : uploading ? "var(--muted)" : "var(--success)" }}>{status}</p>
        )}
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>Filename</th><th>Pages</th><th>Chunks</th><th>Enriched</th><th>Indexed</th><th />
          </tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.name} className="row-hover">
                <td className="font-medium">{d.name}</td>
                <td className="mono">{d.pageCount ?? "–"}</td>
                <td className="mono">{d.chunkCount ?? "–"}</td>
                <td><span className={`badge ${d.enriched ? "badge-success" : "badge-neutral"}`}>{d.enriched ? "yes" : "no"}</span></td>
                <td className="muted">{d.indexedAt ?? "–"}</td>
                <td className="text-right">{d.enriched && <button className="link-btn" onClick={() => void view(d.name)}>View Enriched</button>}</td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr><td colSpan={6}>
                <div className="empty">
                  <p className="font-semibold">No documents yet</p>
                  <p className="muted text-sm">Upload a PDF above so the chatbot has material to answer from.</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {modal && (
        <div className="modal-back" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold">{modal.name}</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(null)}>Close</button>
            </div>
            <pre className="mono whitespace-pre-wrap text-xs">{modal.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
