export interface RuntimeConfig {
  topK: number;
  confidenceThreshold: number;
  webSearchMode: "auto" | "rag_only" | "web_only";
  hardFailNoDocument: boolean;
  jevEnabled: boolean;
  jevRelevanceThreshold: number;
  guardrailEnabled: boolean;
  llmProvider: "openrouter" | "workers-ai";
  llmModelSlug: string;
  ingestionEnrichmentEnabled: boolean;
  ingestionModelSlug: string;
  explainRetrievalMode: "rag_fallback" | "rag_plus_llm";
  conceptExplainerEnabled: boolean;
  questionPaperModelSlug: string | null;
  answerStyle: "auto" | "short" | "detailed";
  dataRetentionDays: number;
}

export const DEFAULTS: RuntimeConfig = {
  topK: 5,
  confidenceThreshold: 0.3,
  webSearchMode: "auto",
  hardFailNoDocument: false,
  jevEnabled: true,
  jevRelevanceThreshold: 1.5,
  guardrailEnabled: true,
  llmProvider: "openrouter",
  llmModelSlug: "openai/gpt-4o-mini",
  ingestionEnrichmentEnabled: true,
  ingestionModelSlug: "google/gemini-2.5-flash",
  explainRetrievalMode: "rag_plus_llm",
  conceptExplainerEnabled: true,
  questionPaperModelSlug: null,
  answerStyle: "auto",
  dataRetentionDays: 90,
};

const ENUMS: Record<string, readonly string[]> = {
  webSearchMode: ["auto", "rag_only", "web_only"],
  llmProvider: ["openrouter", "workers-ai"],
  explainRetrievalMode: ["rag_fallback", "rag_plus_llm"],
  answerStyle: ["auto", "short", "detailed"],
};

/** Returns the coerced value, or undefined if the raw value is invalid for the key. */
function coerce(key: keyof RuntimeConfig, raw: string | null): unknown {
  const def = DEFAULTS[key];
  if (key === "questionPaperModelSlug") return raw === null || raw === "" ? null : raw;
  if (raw === null) return undefined;
  if (typeof def === "number") {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isFinite(n) ? n : undefined;
  }
  if (typeof def === "boolean") {
    const v = raw.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    return undefined;
  }
  if (ENUMS[key]) return ENUMS[key].includes(raw) ? raw : undefined;
  return raw === "" ? undefined : raw;
}

/** Fail-open: any D1 error yields DEFAULTS. */
export async function loadConfig(tenantId: string, db: D1Database): Promise<RuntimeConfig> {
  try {
    const { results } = await db
      .prepare("SELECT key, value FROM config WHERE tenant_id = ?")
      .bind(tenantId)
      .all<{ key: string; value: string | null }>();
    const cfg: Record<string, unknown> = { ...DEFAULTS };
    for (const row of results ?? []) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, row.key)) continue;
      const v = coerce(row.key as keyof RuntimeConfig, row.value);
      if (v !== undefined) cfg[row.key] = v;
    }
    return cfg as unknown as RuntimeConfig;
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConfigField(
  tenantId: string,
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO config (tenant_id, key, value) VALUES (?, ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value",
    )
    .bind(tenantId, key, value)
    .run();
}
