const BASE = ""; // relative — same origin as the worker

export interface TenantInfo {
  tenantId: string;
  name: string;
  logoUrl?: string | null;
  theme?: { primaryColor?: string; accentColor?: string; [k: string]: unknown };
  features?: Record<string, unknown>;
}

export interface DocSource {
  filename: string;
  page?: number;
  snippet?: string;
  pageImageKey?: string;
}

export interface WebSource {
  title?: string;
  url?: string;
  snippet?: string;
}

export interface ChatResponse {
  answer: string;
  docSources: DocSource[];
  webSources?: WebSource[];
  [k: string]: unknown;
}

export interface PracticeQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ExplainResponse {
  concept: string;
  simpleExplanation: string | null;
  steps: string[] | null;
  formula: string | null;
  definition: string | null;
  table: string | null;
  realWorldExample: string | null;
  difficultyLevel?: "basic" | "intermediate" | "advanced" | null;
  keyTakeaways?: string[] | null;
  relatedConcepts?: string[] | null;
  youtubeSearchQuery?: string | null;
  practiceQuestions?: PracticeQuestion[] | null;
  groundedIn?: "documents" | "general_knowledge" | "both";
}

function tenantParam(): string {
  const t = new URLSearchParams(window.location.search).get("tenant");
  return t ? `?tenant=${encodeURIComponent(t)}` : "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const sep = path.includes("?") ? "&" : "";
  const tp = tenantParam();
  const url = BASE + path + (tp ? (path.includes("?") ? "&" + tp.slice(1) : tp) : "");
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchTenant = () => request<TenantInfo>("/api/tenant");
export const postChat = (question: string, answerStyle?: string) =>
  request<ChatResponse>("/api/chat", post({ question, answerStyle }));
export const postExplain = (concept: string) =>
  request<ExplainResponse>("/api/explain", post({ concept }));
