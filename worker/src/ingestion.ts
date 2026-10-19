import type { Env } from "./env";
import type { TenantConfig } from "./tenant";
import { TenantStorage } from "./storage";
import { extractPdfPages } from "./pdf";
import { chunkText } from "./chunker";
import { enrichPdfToMarkdown, parseEnrichedPages } from "./ingestionEnrichment";
import { loadConfig } from "./config";

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const UPSERT_BATCH = 100;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function deleteByPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    if (listed.objects.length > 0) await bucket.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

async function deleteExistingDocument(
  env: Env,
  storage: TenantStorage,
  filename: string,
  oldChunkCount: number,
): Promise<void> {
  const ids: string[] = [];
  for (let i = 0; i < oldChunkCount; i++) ids.push(storage.vectorId(filename, i));
  for (let i = 0; i < ids.length; i += UPSERT_BATCH) {
    await env.VECTORIZE.deleteByIds(ids.slice(i, i + UPSERT_BATCH));
  }
  await deleteByPrefix(env.PDF_BUCKET, storage.r2Key("images", filename) + "/");
  await env.PDF_BUCKET.delete([
    storage.r2Key("cleaned", filename + ".md"),
    storage.r2Key("docs", filename),
  ]);
}

export async function handleIngest(
  request: Request,
  env: Env,
  tenant: TenantConfig,
  _ctx: ExecutionContext,
): Promise<Response> {
  const key = request.headers.get("x-ingest-key");
  if (!env.INGEST_API_KEY || key !== env.INGEST_API_KEY) return json({ error: "Unauthorized" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Expected multipart form data" }, 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "Missing file" }, 400);
  const force = !!form.get("force") && form.get("force") !== "false";

  const storage = new TenantStorage(tenant.tenantId, env);
  const filename = storage.sanitizeFilename((file as File).name ?? "");
  if (!filename) return json({ error: "Invalid filename" }, 400);

  const pdfBytes = await (file as File).arrayBuffer();
  if (pdfBytes.byteLength > tenant.rateLimits.ingestMaxFileSizeMb * 1024 * 1024) {
    return json({ error: "File too large" }, 413);
  }

  const docKey = storage.r2Key("docs", filename);
  const existing = await env.PDF_BUCKET.head(docKey);
  if (existing) {
    if (!force) return json({ skipped: true, filename });
    const oldCount = Number(existing.customMetadata?.chunkCount ?? 0) || 0;
    await deleteExistingDocument(env, storage, filename, oldCount);
  }

  let pages: Array<{ page: number; text: string }>;
  try {
    pages = await extractPdfPages(pdfBytes);
  } catch {
    return json({ error: "Could not read PDF" }, 422);
  }

  const config = await loadConfig(tenant.tenantId, env.DB);
  let enrichedFullText: string | null = null;
  if (config.ingestionEnrichmentEnabled) {
    const enriched = await enrichPdfToMarkdown(pdfBytes, config, env);
    if (enriched) {
      const merged = parseEnrichedPages(enriched, pages);
      if (merged.some((p, i) => p.text !== pages[i].text)) {
        pages = merged;
        enrichedFullText = enriched;
      }
    }
  }

  const chunks = chunkText(pages);
  if (chunks.length === 0) return json({ error: "No extractable text in PDF" }, 422);

  const vectors: VectorizeVector[] = [];
  for (const chunk of chunks) {
    const out = (await env.AI.run(EMBED_MODEL, { text: chunk.text })) as { data?: number[][] };
    const values = out.data?.[0];
    if (!values) return json({ error: "Embedding failed" }, 502);
    const base: Record<string, string> = {
      filename,
      text: chunk.text,
      startPage: String(chunk.startPage),
      endPage: String(chunk.endPage),
      chunkIndex: String(chunk.chunkIndex),
    };
    if (chunk.pageImageKey) base.pageImageKey = storage.r2Key("images", filename, chunk.pageImageKey);
    vectors.push({
      id: storage.vectorId(filename, chunk.chunkIndex),
      values,
      metadata: storage.vectorMeta(base),
    });
  }

  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    await env.VECTORIZE.upsert(vectors.slice(i, i + UPSERT_BATCH));
  }

  // Written last so a failed ingest never leaves a "already indexed" marker behind.
  const enriched = enrichedFullText !== null;
  await env.PDF_BUCKET.put(docKey, pdfBytes, {
    customMetadata: {
      chunkCount: String(chunks.length),
      pageCount: String(pages.length),
      indexedAt: new Date().toISOString(),
      enriched: String(enriched),
    },
  });
  if (enriched) await env.PDF_BUCKET.put(storage.r2Key("cleaned", filename + ".md"), enrichedFullText!);

  return json({ success: true, filename, chunkCount: chunks.length, pageCount: pages.length, enriched });
}
