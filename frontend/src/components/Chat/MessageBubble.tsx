import type { Message } from "../../hooks/useChat";
import { Latex } from "../common/Latex";
import { SourceCard } from "./SourceCard";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const kind = isUser ? "user" : message.isError ? "bot err" : "bot";
  return (
    <div className={`msg ${isUser ? "user" : "bot"}`}>
      <div className="msg-col">
        <div className={`bubble ${kind}`}>
          <Latex text={message.content} />
        </div>
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
