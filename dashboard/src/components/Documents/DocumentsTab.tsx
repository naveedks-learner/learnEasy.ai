import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DocumentInfo } from "../../api/client";

const INGEST_KEY_STORAGE = "learneasy.ingestKey";

export default function DocumentsTab({ tenantId }: { tenantId: string }) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
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
    try {
      await api.ingest(tenantId, file, key);
      setStatus(`Indexed ${file.name}`);
      load();
    } catch (e) {
      setStatus(`Upload failed: ${(e as Error).message}`);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const view = async (name: string) => {
    try { setModal(await api.cleaned(tenantId, name)); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Upload PDF</button>
        {status && <span className="text-sm text-slate-600">{status}</span>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <table className="w-full bg-white text-left text-sm">
        <thead className="border-b text-slate-500"><tr>
          <th className="p-2">Filename</th><th className="p-2">Pages</th><th className="p-2">Chunks</th><th className="p-2">Enriched</th><th className="p-2">Indexed</th><th />
        </tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.name} className="border-b">
              <td className="p-2">{d.name}</td><td className="p-2">{d.pageCount ?? "–"}</td><td className="p-2">{d.chunkCount ?? "–"}</td>
              <td className="p-2">{d.enriched ? "yes" : "no"}</td><td className="p-2">{d.indexedAt ?? "–"}</td>
              <td className="p-2">{d.enriched && <button className="text-blue-600 underline" onClick={() => void view(d.name)}>View Enriched</button>}</td>
            </tr>
          ))}
          {docs.length === 0 && <tr><td colSpan={6} className="p-3 text-slate-500">No documents.</td></tr>}
        </tbody>
      </table>
      {modal && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-between"><h3 className="font-semibold">{modal.name}</h3>
              <button onClick={() => setModal(null)}>Close</button></div>
            <pre className="whitespace-pre-wrap text-xs">{modal.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
