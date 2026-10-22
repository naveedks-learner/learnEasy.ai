import { useEffect, useState } from "react";
import { tenantParam } from "../../api/client";

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

export function PageImage({ imageKey, alt }: { imageKey: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  const src = `/api/images/${imageKey.split("/").map(encodeURIComponent).join("/")}${tenantParam()}`;
  const label = alt ?? "Source page from textbook";
  return (
    <>
      <img
        src={src}
        alt={label}
        className="page-image"
        loading="lazy"
        onClick={() => setOpen(true)}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      {open && <Lightbox src={src} alt={label} onClose={() => setOpen(false)} />}
    </>
  );
}
