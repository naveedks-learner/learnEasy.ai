import type { Message } from "../../hooks/useChat";
import { Latex } from "../common/Latex";
import { SourceCard } from "./SourceCard";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] space-y-2">
        <div
          className={`rounded-2xl px-4 py-2 ${
            isUser
              ? "bg-[var(--color-primary)] text-white"
              : message.isError
                ? "bg-red-50 text-red-700 border border-red-200"
                : "bg-white border border-slate-200"
          }`}
        >
          <Latex text={message.content} />
        </div>
        {message.docSources && message.docSources.length > 0 && (
          <div className="space-y-2">
            {message.docSources.map((s, i) => (
              <SourceCard key={i} source={s} />
            ))}
          </div>
        )}
        {message.webSources && message.webSources.length > 0 && (
          <ul className="text-sm text-slate-600 space-y-1">
            {message.webSources.map((w, i) => (
              <li key={i}>
                {w.url ? (
                  <a href={w.url} target="_blank" rel="noopener noreferrer" className="underline text-[var(--color-primary)]">
                    {w.title || w.url}
                  </a>
                ) : (
                  w.title
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
