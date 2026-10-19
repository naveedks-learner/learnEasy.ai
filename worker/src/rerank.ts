import type { Env } from "./env";

type Chunk = { text: string; score: number; [k: string]: any };

export async function rerank(query: string, chunks: Chunk[], env: Env): Promise<Chunk[]> {
  if (chunks.length === 0) return chunks;
  try {
    const out: any = await (env.AI as any).run("@cf/baai/bge-reranker-base", {
      query,
      texts: chunks.map((c) => c.text),
    });
    // Workers AI returns { response: [{id, score}] }; accept { data: [{score}] } too.
    const rows: any[] | undefined = out?.response ?? out?.data;
    if (!Array.isArray(rows) || rows.length !== chunks.length) return chunks;
    const scored = chunks.map((c, i) => {
      const row = rows.find((r) => r.id === i) ?? rows[i];
      const s = Number(row?.score);
      if (!Number.isFinite(s)) throw new Error("bad rerank score");
      return { ...c, rerankScore: s };
    });
    return scored.sort((a, b) => b.rerankScore - a.rerankScore);
  } catch {
    return chunks;
  }
}
