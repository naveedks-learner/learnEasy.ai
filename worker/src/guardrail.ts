import type { Env } from "./env";

export const BLOCKED_KEYWORDS: string[] = [
  "bomb", "explosive", "how to kill", "murder", "massacre", "school shooting",
  "suicide", "kill myself", "self-harm", "self harm", "cut myself", "end my life",
  "porn", "sex video", "nude", "explicit sex", "erotic",
  "cocaine", "heroin", "methamphetamine", "crystal meth", "buy drugs", "make drugs",
  "buy a gun", "make a gun", "build a weapon", "ghost gun", "napalm", "grenade",
];

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

export async function guardrailCheck(
  text: string,
  env: Env,
): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const lowered = text.toLowerCase();
    const hit = BLOCKED_KEYWORDS.find((k) => lowered.includes(k));
    if (hit) return { blocked: true, reason: "blocked keyword" };

    // Embedding call is the hook for the future similarity scope check; until
    // then it only serves to fail closed when the AI binding is unavailable.
    await env.AI.run(EMBEDDING_MODEL, { text: [text] });

    return { blocked: false };
  } catch {
    return { blocked: true, reason: "guardrail error" };
  }
}
