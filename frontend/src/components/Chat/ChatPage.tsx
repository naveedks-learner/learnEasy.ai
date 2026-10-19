import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChat } from "../../hooks/useChat";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { MessageBubble } from "./MessageBubble";

export function ChatPage() {
  const { messages, loading, sendMessage } = useChat();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages, loading]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    void sendMessage(input);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && <p className="text-center text-slate-500 mt-8">Ask a question about your subjects.</p>}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {loading && <LoadingSpinner label="Waiting for answer" />}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2 p-3 border-t border-slate-200 bg-white">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg px-4 py-2 text-white bg-[var(--color-primary)] disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
