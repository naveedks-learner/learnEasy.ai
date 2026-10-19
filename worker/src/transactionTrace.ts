export interface TraceChunk {
  text: string;
  score: number;
  kept: boolean;
  [key: string]: unknown;
}

export interface TransactionTraceInput {
  pathTaken: string;
  question: string;
  answer: string;
  model: string;
  provider: string;
  chunks: TraceChunk[];
  tokenEstimate: number;
  extra?: Record<string, unknown>;
}

export interface TransactionRow {
  path_taken: string;
  question: string;
  answer: string;
  model: string;
  provider: string;
  trace_json: string;
  token_estimate: number;
}

export function buildTransactionTrace(data: TransactionTraceInput): TransactionRow {
  return {
    path_taken: data.pathTaken,
    question: data.question,
    answer: data.answer,
    model: data.model,
    provider: data.provider,
    trace_json: JSON.stringify({ chunks: data.chunks, ...(data.extra ?? {}) }),
    token_estimate: data.tokenEstimate,
  };
}

export async function insertTransaction(row: TransactionRow, tenantId: string, db: D1Database): Promise<void> {
  await db
    .prepare(
      "INSERT INTO transactions (tenant_id, path_taken, question, answer, model, provider, trace_json, token_estimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(tenantId, row.path_taken, row.question, row.answer, row.model, row.provider, row.trace_json, row.token_estimate)
    .run();
}
