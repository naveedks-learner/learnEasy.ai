import { useEffect, useRef, useState } from "react";
import { tenantParam } from "../../api/client";
import { getApiBase } from "../../api/platform";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const pdfCache = new Map<string, Promise<pdfjsLib.PDFDocumentProxy>>();

function getPdf(url: string): Promise<pdfjsLib.PDFDocumentProxy> {
  let cached = pdfCache.get(url);
  if (!cached) {
    cached = pdfjsLib.getDocument(url).promise;
    cached.catch(() => pdfCache.delete(url));
    pdfCache.set(url, cached);
  }
  return cached;
}

function Lightbox({ canvasUrl, alt, onClose }: { canvasUrl: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Source image" onClick={onClose}>
      <button type="button" className="close" onClick={onClose} aria-label="Close image">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <img src={canvasUrl} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

export function PdfPageRenderer({ filename, page, alt }: { filename: string; page: number; alt?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const label = alt ?? `Page ${page} of ${filename}`;

  useEffect(() => {
    let cancelled = false;
    const url = `${getApiBase()}/api/docs/${encodeURIComponent(filename)}${tenantParam()}`;

    getPdf(url)
      .then((pdf) => pdf.getPage(page))
      .then((pdfPage) => {
        if (cancelled) return;
        const scale = 1.5;
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        return pdfPage.render({ canvasContext: ctx, viewport }).promise.then(() => {
          if (!cancelled) setDataUrl(canvas.toDataURL("image/png"));
        });
      })
      .catch(() => { if (!cancelled) setError(true); });

    return () => { cancelled = true; };
  }, [filename, page]);

  if (error) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="page-image"
        style={{ cursor: "pointer", display: dataUrl ? "block" : "none" }}
        onClick={() => setOpen(true)}
        role="img"
        aria-label={label}
      />
      {!dataUrl && !error && <div className="page-image-loading">Loading page…</div>}
      {open && dataUrl && <Lightbox canvasUrl={dataUrl} alt={label} onClose={() => setOpen(false)} />}
    </>
  );
}
