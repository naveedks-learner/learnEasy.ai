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
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
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
      head: { customMetadata: { chunkCount: "2" } },
      onDelete: (k) => deletedKeys.push(k),
      onDeleteIds: (ids) => deletedIds.push(...ids),
    });
    const res = await handleIngest(buildReq("existing.pdf", true), env, tenant, ctx);
    expect(((await res.json()) as any).success).toBe(true);
    expect(deletedIds).toHaveLength(2);
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
});
