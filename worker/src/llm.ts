import type { Env } from "./env";
import type { RuntimeConfig } from "./config";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface LlmResult {
  text: string;
  model: string;
  provider: string;
  tokenEstimate: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

function estimateTokens(messages: ChatMessage[], output: string): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0) + output.length;
  return Math.ceil(chars / 4);
}

// Deliberately throws on any failure: a silent provider/model fallback would hide cost/quality regressions.
export async function generateChatCompletion(
  messages: ChatMessage[],
  config: RuntimeConfig,
  env: Env,
  opts: { modelOverride?: string; maxTokens?: number } = {},
): Promise<LlmResult> {
  if (config.llmProvider === "workers-ai") {
    const res = (await env.AI.run(WORKERS_AI_MODEL as any, {
      messages,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    } as any)) as { response?: string };
    const text = res?.response;
    if (typeof text !== "string") throw new Error("Workers AI returned no response text");
    return {
      text,
      model: WORKERS_AI_MODEL,
      provider: "workers-ai",
      tokenEstimate: estimateTokens(messages, text),
      inputTokens: null,
      outputTokens: null,
    };
  }

  const model = opts.modelOverride ?? config.llmModelSlug;
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) {
    throw new Error(`OpenRouter request failed: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("OpenRouter returned no message content");
  return {
    text,
    model,
    provider: "openrouter",
    tokenEstimate: data.usage?.total_tokens ?? estimateTokens(messages, text),
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
  };
}
