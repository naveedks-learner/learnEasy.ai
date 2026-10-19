import type { DocSource } from "../../api/client";

export function SourceCard({ source }: { source: DocSource }) {
  const imageUrl = source.pageImageKey
    ? `/api/images/${source.pageImageKey.split("/").map(encodeURIComponent).join("/")}`
    : null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="font-medium text-slate-700">
        {source.filename}
        {source.page != null && <span className="text-slate-500"> · page {source.page}</span>}
      </div>
      {source.snippet && <p className="mt-1 text-slate-600">{source.snippet}</p>}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={`Page ${source.page ?? ""} of ${source.filename}`}
          loading="lazy"
          className="mt-2 max-h-96 w-full rounded border border-slate-200 object-contain"
        />
      )}
    </div>
  );
}
