import { describe, it, expect, vi } from "vitest";

vi.mock("../src/pdf", () => ({
  extractPdfPages: vi.fn(async () => [
    { page: 1, text: "alpha beta gamma" },
    { page: 2, text: "delta epsilon" },
  ]),
}));
vi.mock("../src/ingestionEnrichment", () => ({
  enrichPdfToMarkdown: vi.fn(async () => null),
  parseEnrichedPages: vi.fn((_t: string, p: unknown) => p),
}));

import { enrichPdfToMarkdown, parseEnrichedPages } from "../src/ingestionEnrichment";
import { handleIngest } from "../src/ingestion";

const tenant: any = { tenantId: "test-tenant", rateLimits: { ingestMaxFileSizeMb: 50 } };
const ctx: any = { waitUntil: () => {} };

function mockEnv(opts: {
  head?: any;
  onPut?: (k: string) => void;
  onDelete?: (k: string) => void;
  onUpsert?: (v: any[]) => void;
  onDeleteIds?: (ids: string[]) => void;
} = {}): any {
  return {
    INGEST_API_KEY: "secret",
    DB: {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
    },
    AI: { run: async (_m: string, i: any) => ({ data: i.text.map(() => [0.1, 0.2]) }) },
    VECTORIZE: {
      upsert: async (v: any[]) => opts.onUpsert?.(v),
      deleteByIds: async (ids: string[]) => opts.onDeleteIds?.(ids),
    },
    PDF_BUCKET: {
      head: async () => opts.head ?? null,
      put: async (k: string) => opts.onPut?.(k),
      delete: async (k: string | string[]) => [k].flat().forEach((x) => opts.onDelete?.(x)),
      list: async () => ({ objects: [{ key: "t/test-tenant/images/existing.pdf/1.png" }], truncated: false }),
    },
  };
}

function buildReq(name: string, force = false, key: string | null = "secret"): Request {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" }));
  if (force) form.append("force", "true");
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    body: form,
    headers: key ? { "x-ingest-key": key } : {},
  });
}

describe("handleIngest", () => {
  it("rejects request without ingest key", async () => {
    const res = await handleIngest(buildReq("a.pdf", false, null), mockEnv(), tenant, ctx);
    expect(res.status).toBe(401);
  });

  it("skips already-indexed file (dedup check)", async () => {
    const env = mockEnv({ head: { customMetadata: { chunkCount: "2" } } });
    const body = (await (await handleIngest(buildReq("existing.pdf"), env, tenant, ctx)).json()) as any;
    expect(body.skipped).toBe(true);
  });

  it("re-ingests when force=true, deleting old vectors and R2 objects", async () => {
    const deletedKeys: string[] = [];
    const deletedIds: string[] = [];
    const env = mockEnv({
      head: { customMetadata: { chunkCount: "3" } },
      onDelete: (k) => deletedKeys.push(k),
      onDeleteIds: (ids) => deletedIds.push(...ids),
    });
    const res = await handleIngest(buildReq("existing.pdf", true), env, tenant, ctx);
    expect(((await res.json()) as any).success).toBe(true);
    expect(deletedIds).toHaveLength(2);
    expect(deletedIds).not.toContain(undefined);
    expect(deletedKeys).toContain("t/test-tenant/images/existing.pdf/1.png");
    expect(deletedKeys).toContain("t/test-tenant/cleaned/existing.pdf.md");
  });

  it("writes R2 only after Vectorize upsert, all keys tenant-scoped", async () => {
    const order: string[] = [];
    const written: string[] = [];
    const env = mockEnv({
      onPut: (k) => {
        order.push("r2");
        written.push(k);
      },
      onUpsert: () => order.push("vec"),
    });
    const body = (await (await handleIngest(buildReq("new.pdf"), env, tenant, ctx)).json()) as any;
    expect(body.success).toBe(true);
    expect(order).toEqual(["vec", "r2"]);
    expect(written.every((k) => k.startsWith("t/test-tenant/"))).toBe(true);
  });

  it("writes nothing to R2 when upsert fails", async () => {
    const written: string[] = [];
    const env = mockEnv({
      onPut: (k) => written.push(k),
      onUpsert: () => {
        throw new Error("boom");
      },
    });
    await expect(handleIngest(buildReq("new.pdf"), env, tenant, ctx)).rejects.toThrow();
    expect(written).toEqual([]);
  });

  it("force: keeps old document when new ingest fails before upsert", async () => {
    const deleted: string[] = [];
    const deletedIds: string[] = [];
    const env = mockEnv({
      head: { customMetadata: { chunkCount: "3" } },
      onDelete: (k) => deleted.push(k),
      onDeleteIds: (i) => deletedIds.push(...i),
    });
    env.AI.run = async () => ({});
    const res = await handleIngest(buildReq("existing.pdf", true), env, tenant, ctx);
    expect(res.status).toBe(502);
    expect(deleted).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it("batches embeddings into one call", async () => {
    const env = mockEnv();
    const run = vi.fn(async (_m: string, i: any) => ({ data: i.text.map(() => [0.1]) }));
    env.AI.run = run;
    await handleIngest(buildReq("new.pdf"), env, tenant, ctx);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not emit pageImageKey in vector metadata", async () => {
    let upserted: any[] = [];
    const env = mockEnv({ onUpsert: (v) => (upserted = v) });
    await handleIngest(buildReq("new.pdf"), env, tenant, ctx);
    expect(upserted.length).toBeGreaterThan(0);
    expect(upserted.every((v) => !("pageImageKey" in v.metadata))).toBe(true);
  });

  it("uses enriched pages and writes cleaned text + enriched metadata", async () => {
    vi.mocked(enrichPdfToMarkdown).mockResolvedValueOnce("<<<PAGE 1>>> ENRICHED one [Figure: x]");
    vi.mocked(parseEnrichedPages).mockImplementationOnce((_t: string, p: any) => [
      { page: 1, text: "ENRICHED one [Figure: x]" },
      p[1],
    ]);
    const puts: Array<[string, any]> = [];
    let upserted: any[] = [];
    const env = mockEnv({ onUpsert: (v) => (upserted = v) });
    env.PDF_BUCKET.put = async (k: string, _b: any, o: any) => void puts.push([k, o]);
    const body = (await (await handleIngest(buildReq("new.pdf"), env, tenant, ctx)).json()) as any;
    expect(body.enriched).toBe(true);
    expect(puts.find(([k]) => k === "t/test-tenant/cleaned/new.pdf.md")).toBeTruthy();
    expect(puts.find(([k]) => k === "t/test-tenant/docs/new.pdf")![1].customMetadata.enriched).toBe("true");
    expect(upserted[0].metadata.text).toContain("ENRICHED");
  });
});
