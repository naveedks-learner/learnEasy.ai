import { useEffect, useState } from "react";
import type { DocSource } from "../../api/client";

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
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
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

export function SourceCard({ source }: { source: DocSource }) {
  const [open, setOpen] = useState(false);
  const imageUrl = source.pageImageKey
    ? `/api/images/${source.pageImageKey.split("/").map(encodeURIComponent).join("/")}`
    : null;
  const alt = `Page ${source.page ?? ""} of ${source.filename}`;
  return (
    <div className="src">
      <div className="src-name">
        {source.filename}
        {source.page != null && <span>page {source.page}</span>}
      </div>
      {source.snippet && <p className="src-snip">{source.snippet}</p>}
      {imageUrl && (
        <>
          <button type="button" className="thumb" onClick={() => setOpen(true)} aria-label={`Enlarge ${alt}`}>
            <img src={imageUrl} alt={alt} loading="lazy" />
          </button>
          {open && <Lightbox src={imageUrl} alt={alt} onClose={() => setOpen(false)} />}
        </>
      )}
    </div>
  );
}
