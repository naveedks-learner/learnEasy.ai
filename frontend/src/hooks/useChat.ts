import { useCallback, useState } from "react";
import { postChat, type DocSource, type WebSource } from "../api/client";

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  docSources?: DocSource[];
  webSources?: WebSource[];
  isError?: boolean;
}

let nextId = 1;

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(async (question: string, answerStyle?: string) => {
    const q = question.trim();
    if (!q) return;
    setMessages((m) => [...m, { id: nextId++, role: "user", content: q }]);
    setLoading(true);
    try {
      const r = await postChat(q, answerStyle);
      setMessages((m) => [
        ...m,
        { id: nextId++, role: "assistant", content: r.answer, docSources: r.docSources, webSources: r.webSources },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { id: nextId++, role: "assistant", content: (e as Error).message || "Something went wrong.", isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { messages, loading, sendMessage };
}
