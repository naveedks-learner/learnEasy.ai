import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChat } from "../../hooks/useChat";
import { Thinking } from "../common/LoadingSpinner";
import { MessageBubble } from "./MessageBubble";

const SUGGESTIONS = ["Explain Newton's second law", "How does photosynthesis work?", "Solve a quadratic equation"];

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
      <div className="scroll">
        {messages.length === 0 && (
          <div className="empty">
            <div className="orb" aria-hidden="true" />
            <h2>What shall we learn today?</h2>
            <p>Ask a question about your science or maths subjects.</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => void sendMessage(s)} disabled={loading}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {loading && <Thinking />}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question…"
          aria-label="Your question"
          className="input"
        />
        <button type="submit" disabled={loading || !input.trim()} className="send" aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}
