import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DocumentInfo } from "../../api/client";

const INGEST_KEY_STORAGE = "learneasy.ingestKey";

interface ChunkInfo { text: string; startPage: number; endPage: number; chunkIndex: number }

function ChunksModal({ tenantId, name, onClose }: { tenantId: string; name: string; onClose: () => void }) {
  const [chunks, setChunks] = useState<ChunkInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.documentChunks(tenantId, name)
      .then((r) => setChunks(r.chunks))
      .catch((e) => setError((e as Error).message));
  }, [tenantId, name]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-semibold">Chunks — {name}</h3>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        {error && <p className="alert alert-error mb-3">{error}</p>}
        {!chunks && !error && <p className="muted text-center">Loading chunks…</p>}
        {chunks && (
          <>
            <p className="muted text-xs mb-3">{chunks.length} chunks (300 words, 50 overlap)</p>
            <div className="chunks-list">
              {chunks.map((c) => (
                <details key={c.chunkIndex} className="chunk-row">
                  <summary style={{ cursor: "pointer", listStyle: "none" }}>
                    <div className="chunk-header">
                      <span className="chunk-idx">#{c.chunkIndex + 1}</span>
                      <span className="muted text-xs">Pages {c.startPage}–{c.endPage}</span>
                      <span className="muted text-xs" style={{ marginLeft: "auto" }}>{c.text.split(/\s+/).length} words</span>
                    </div>
                  </summary>
                  <pre className="chunk-text" style={{ marginTop: 8 }}>{c.text}</pre>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DocumentsTab({ tenantId }: { tenantId: string }) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [forceReingest, setForceReingest] = useState(false);
  const [modal, setModal] = useState<{ name: string; text: string } | null>(null);
  const [chunksDoc, setChunksDoc] = useState<string | null>(null);
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

  const [ingestKeyInput, setIngestKeyInput] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const getIngestKey = (): string | null => {
    let key: string | null = null;
    try { key = localStorage.getItem(INGEST_KEY_STORAGE); } catch { /* ignore */ }
    return key;
  };

  const clearIngestKey = () => {
    try { localStorage.removeItem(INGEST_KEY_STORAGE); } catch { /* ignore */ }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const key = getIngestKey();
    if (!key) {
      setPendingFile(file);
      setShowKeyForm(true);
      return;
    }
    setStatus(`${forceReingest ? "Re-ingesting" : "Uploading"} ${file.name}…`);
    setUploading(true);
    try {
      const result = await api.ingest(tenantId, file, key, forceReingest) as any;
      const skipped = result?.skipped;
      if (skipped) {
        setStatus(`"${file.name}" already exists. Check "Force re-ingest" to replace it.`);
      } else {
        setStatus(`Indexed ${file.name}`);
      }
      load();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("401") || msg.includes("Unauthorized")) {
        clearIngestKey();
        setPendingFile(file);
        setShowKeyForm(true);
        setStatus("Ingest key was invalid — please enter a new one.");
      } else {
        setStatus(`Upload failed: ${msg}`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitIngestKey = () => {
    if (!ingestKeyInput.trim()) return;
    try { localStorage.setItem(INGEST_KEY_STORAGE, ingestKeyInput.trim()); } catch { /* ignore */ }
    setShowKeyForm(false);
    setIngestKeyInput("");
    if (pendingFile) { void upload(pendingFile); setPendingFile(null); }
  };

  const retryScreenshots = async (docName: string) => {
    setStatus(`Capturing screenshots for ${docName}…`);
    setUploading(true);
    try {
      const data = await api.retryScreenshots(tenantId, docName);
      const warnings = data.screenshotWarnings as string[] | undefined;
      const warnText = warnings?.length ? ` ⚠ ${warnings.join("; ")}` : "";
      setStatus(`Screenshots for ${docName}: ${data.screenshotsCaptured} captured${warnText}`);
      load();
    } catch (e) {
      setStatus(`Screenshot retry failed: ${(e as Error).message}`);
    }
    setUploading(false);
  };

  const reingest = async (docName: string) => {
    if (!window.confirm(`Re-ingest "${docName}"? This will re-extract, re-chunk, re-embed, and recapture page screenshots.`)) return;
    setStatus(`Re-ingesting ${docName}…`);
    setUploading(true);
    try {
      const data = await api.reingest(tenantId, docName) as any;
      const warnings = data.screenshotWarnings as string[] | undefined;
      const warnText = warnings?.length ? ` ⚠ ${warnings.join("; ")}` : "";
      setStatus(`Re-ingested ${docName} — ${data.chunkCount} chunks, ${data.screenshotsCaptured} screenshots${warnText}`);
      load();
    } catch (e) {
      setStatus(`Re-ingest failed: ${(e as Error).message}`);
    }
    setUploading(false);
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
          <p className="mt-3 text-sm font-medium" style={{ color: failed || status.includes("already exists") ? "var(--error)" : uploading ? "var(--muted)" : "var(--success)" }}>{status}</p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm" style={{ cursor: "pointer", userSelect: "none" }}>
        <input type="checkbox" checked={forceReingest} onChange={(e) => setForceReingest(e.target.checked)} />
        Force re-ingest (replace an already-indexed document with this filename)
      </label>
      {showKeyForm && (
        <div className="card" style={{ padding: 16 }}>
          <p className="font-semibold mb-2">Enter Ingest API Key</p>
          <div className="flex gap-2 items-center">
            <input type="password" className="input" style={{ flex: 1 }} placeholder="Ingest API key"
              value={ingestKeyInput} onChange={(e) => setIngestKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitIngestKey(); }} autoFocus />
            <button className="btn btn-primary btn-sm" onClick={submitIngestKey} disabled={!ingestKeyInput.trim()}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowKeyForm(false); setPendingFile(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {!showKeyForm && getIngestKey() && (
        <div className="flex justify-end">
          <button className="link-btn text-xs" onClick={() => { clearIngestKey(); setStatus("Ingest key cleared."); }}>Change ingest key</button>
        </div>
      )}
      {error && <p className="alert alert-error">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>Filename</th><th>Pages</th><th>Chunks</th><th>Enriched</th><th>Screenshots</th><th>Indexed</th><th />
          </tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.name} className="row-hover">
                <td className="font-medium">{d.name}</td>
                <td className="mono">{d.pageCount ?? "–"}</td>
                <td className="mono">{d.chunkCount ?? "–"}</td>
                <td><span className={`badge ${d.enriched ? "badge-success" : "badge-neutral"}`}>{d.enriched ? "yes" : "no"}</span></td>
                <td className="mono">{d.screenshotPages ?? "–"}</td>
                <td className="muted">{d.indexedAt ? new Date(d.indexedAt.endsWith("Z") ? d.indexedAt : d.indexedAt + "Z").toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) : "–"}</td>
                <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                  <button className="link-btn" onClick={() => setChunksDoc(d.name)} style={{ marginRight: 8 }}>Chunks</button>
                  {d.enriched && <button className="link-btn" onClick={() => void view(d.name)} style={{ marginRight: 8 }}>Enriched</button>}
                  {!d.screenshotPages && <button className="link-btn" onClick={() => void retryScreenshots(d.name)} disabled={uploading} style={{ marginRight: 8 }}>Screenshots</button>}
                  <button className="link-btn" onClick={() => void reingest(d.name)} disabled={uploading}>Re-ingest</button>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr><td colSpan={7}>
                <div className="empty">
                  <p className="font-semibold">No documents yet</p>
                  <p className="muted text-sm">Upload a PDF above so the chatbot has material to answer from.</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {chunksDoc && <ChunksModal tenantId={tenantId} name={chunksDoc} onClose={() => setChunksDoc(null)} />}
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
