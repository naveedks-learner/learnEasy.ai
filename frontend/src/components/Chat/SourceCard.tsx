import { tenantParam, type DocSource } from "../../api/client";
import { getApiBase } from "../../api/platform";

export function SourceCard({ source }: { source: DocSource }) {
  const downloadUrl = source.filename
    ? `${getApiBase()}/api/docs/${encodeURIComponent(source.filename)}${tenantParam()}`
    : null;
  return (
    <div className="src">
      <div className="src-name">
        <span>{source.filename}{source.page != null && <span> page {source.page}</span>}</span>
        {downloadUrl && (
          <a href={downloadUrl} className="src-download" title="Download PDF" download>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </a>
        )}
      </div>
      {source.snippet && <p className="src-snip">{source.snippet}</p>}
    </div>
  );
}
