import type { Message } from "../../hooks/useChat";
import { Latex } from "../common/Latex";
import { PageImage } from "../common/PageImage";
import { PdfPageRenderer } from "../common/PdfPageRenderer";
import { SourceCard } from "./SourceCard";

function collectFigurePages(sources: Message["docSources"]): Array<{ filename: string; page: number; imageKey?: string }> {
  if (!sources) return [];
  const seen = new Set<string>();
  const result: Array<{ filename: string; page: number; imageKey?: string }> = [];

  for (const s of sources) {
    if (s.pageImageKey) {
      const key = `${s.filename}:${s.page ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ filename: s.filename, page: s.page ?? 0, imageKey: s.pageImageKey });
      }
    }
    if (s.figurePages) {
      for (const p of s.figurePages) {
        const key = `${s.filename}:${p}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ filename: s.filename, page: p });
        }
      }
    }
    if (!s.pageImageKey && !s.figurePages?.length && s.hasFigure && s.filename && s.page != null) {
      const key = `${s.filename}:${s.page}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ filename: s.filename, page: s.page });
      }
    }
  }
  return result;
}

function filterByRelevant(
  all: Array<{ filename: string; page: number; imageKey?: string }>,
  relevant: Array<{ filename: string; page: number }>,
): Array<{ filename: string; page: number; imageKey?: string }> {
  const keys = new Set(relevant.map((r) => `${r.filename}:${r.page}`));
  return all.filter((fp) => keys.has(`${fp.filename}:${fp.page}`));
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const kind = isUser ? "user" : message.isError ? "bot err" : "bot";
  const allFigures = isUser ? [] : collectFigurePages(message.docSources);
  const figurePages = message.relevantFigures?.length
    ? filterByRelevant(allFigures, message.relevantFigures)
    : allFigures;

  return (
    <div className={`msg ${isUser ? "user" : "bot"}`}>
      <div className="msg-col">
        <div className={`bubble ${kind}`}>
          <Latex text={message.content} />
        </div>
        {figurePages.length > 0 && (
          <div className="answer-figures">
            {figurePages.map((fp) =>
              fp.imageKey ? (
                <PageImage key={fp.imageKey} imageKey={fp.imageKey} alt={`Page ${fp.page} of ${fp.filename}`} />
              ) : (
                <PdfPageRenderer key={`${fp.filename}:${fp.page}`} filename={fp.filename} page={fp.page} alt={`Page ${fp.page} of ${fp.filename}`} />
              ),
            )}
          </div>
        )}
        {message.docSources && message.docSources.length > 0 && (
          <div className="sources">
            <div className="src-label">Sources</div>
            {message.docSources.map((s, i) => (
              <SourceCard key={i} source={s} />
            ))}
          </div>
        )}
        {message.webSources && message.webSources.length > 0 && (
          <div className="sources">
            <div className="src-label">From the web</div>
            {message.webSources.map((w, i) =>
              w.url ? (
                <a key={i} href={w.url} target="_blank" rel="noopener noreferrer" className="web-link">
                  {w.title || w.url}
                </a>
              ) : (
                <span key={i} className="web-link">
                  {w.title}
                </span>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
