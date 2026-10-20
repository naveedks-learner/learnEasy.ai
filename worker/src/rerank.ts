import type { Env } from "./env";

type Chunk = { text: string; score: number; [k: string]: any };

interface RerankRow {
  id: number;
  score: number;
}

/**
 * Cross-encoder reranker via Workers AI bge-reranker-base.
 *
 * Cosine similarity (from Vectorize) is not well-calibrated as an absolute
 * relevance signal — unrelated passages routinely score 0.6–0.8 because the
 * embedding space clusters around generic "this is English text." A cross-encoder
 * reads query + passage together in one forward pass and produces a genuine
 * relevance score whose spread separates relevant from irrelevant far more cleanly.
 *
 * API contract (developers.cloudflare.com/workers-ai/models/bge-reranker-base):
 *   Input:  { query: string, contexts: Array<{ text: string }> }
 *   Output: { response: Array<{ id: number (index into contexts), score: number }> }
 *
 * Fails open: any error returns chunks in their original cosine order without
 * rerankScore, so callers fall back gracefully.
 */
export async function rerank(query: string, chunks: Chunk[], env: Env): Promise<Chunk[]> {
  if (chunks.length === 0) return chunks;
  try {
    const out: any = await (env.AI as any).run("@cf/baai/bge-reranker-base", {
      query,
      contexts: chunks.map((c) => ({ text: c.text })),
    });

    const rows: RerankRow[] | undefined = out?.response;
    if (!Array.isArray(rows) || rows.length !== chunks.length) {
      console.log("[rerank] unexpected response shape, falling back to cosine order");
      return chunks;
    }

    const byId = new Map<number, number>();
    for (const row of rows) {
      if (typeof row.id !== "number" || !Number.isFinite(row.score)) {
        console.log("[rerank] malformed row, falling back:", JSON.stringify(row));
        return chunks;
      }
      byId.set(row.id, row.score);
    }

    const scored = chunks.map((c, i) => {
      const s = byId.get(i);
      if (s === undefined) return c;
      return { ...c, rerankScore: s };
    });

    if (!scored.every((c) => typeof c.rerankScore === "number")) {
      console.log("[rerank] missing scores for some chunks, falling back");
      return chunks;
    }

    return scored.sort((a, b) => (b.rerankScore as number) - (a.rerankScore as number));
  } catch (e) {
    console.log("[rerank] error:", (e as Error).message);
    return chunks;
  }
}
