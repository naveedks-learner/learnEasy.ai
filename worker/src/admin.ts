import { Hono } from "hono";
import type { Env } from "./env";
import { buildCorsHeaders } from "./cors";
import { tenantFromRow } from "./tenant";
import { TenantStorage } from "./storage";
import { DEFAULTS, loadConfig, saveConfigField } from "./config";
import { chunkText, semanticChunkText } from "./chunker";
import { rerank } from "./rerank";
import { extractPdfPages } from "./pdf";
import { enrichPdfToMarkdown, parseEnrichedPages } from "./ingestionEnrichment";
import { captureAndStoreFigurePages } from "./screenshots";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CONFIG_ENUMS: Record<string, readonly string[]> = {
  webSearchMode: ["auto", "rag_only", "web_only"],
  llmProvider: ["openrouter", "workers-ai"],
  explainRetrievalMode: ["rag_fallback", "rag_plus_llm"],
  answerStyle: ["auto", "short", "detailed"],
};

function validateConfigValue(key: keyof typeof DEFAULTS, value: string): boolean {
  if (key === "questionPaperModelSlug") return true;
  const def = DEFAULTS[key];
  if (typeof def === "number") {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return false;
    if (key === "dataRetentionDays") return Number.isInteger(n) && n >= 1;
    return key === "topK" ? Number.isInteger(n) && n >= 0 : true;
  }
  if (typeof def === "boolean") return value === "true" || value === "false";
  if (CONFIG_ENUMS[key]) return CONFIG_ENUMS[key].includes(value);
  return value.trim() !== "";
}

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use("*", async (c, next) => {
  const adminHost = c.env.ADMIN_HOSTNAME;
  const cors = buildCorsHeaders(c.req.header("Origin") ?? "", [], adminHost ?? "");
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const skipHostCheck = c.env.ENVIRONMENT === "development" || c.env.ENVIRONMENT === "staging";
  if (adminHost && !skipHostCheck && new URL(c.req.url).host !== adminHost) return c.json({ error: "Not found" }, 404);
  const key = c.req.header("x-admin-key");
  if (!c.env.ADMIN_API_KEY || key !== c.env.ADMIN_API_KEY) return c.json({ error: "Unauthorized" }, 401);
  await next();
  for (const [k, v] of Object.entries(cors)) c.res.headers.set(k, v);
});

adminRoutes.get("/tenants", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM tenants").all<Record<string, unknown>>();
  return c.json({ tenants: (results ?? []).map(tenantFromRow) });
});

adminRoutes.post("/tenants", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const tenantId = body?.tenantId;
  const name = body?.name;
  const domain = body?.domain;
  if (typeof tenantId !== "string" || !SLUG_RE.test(tenantId)) {
    return c.json({ error: "tenantId must be a lowercase slug (a-z, 0-9, hyphens)" }, 400);
  }
  if (typeof name !== "string" || !name || typeof domain !== "string" || !domain) {
    return c.json({ error: "name and domain are required" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE tenant_id = ? OR domain = ?")
    .bind(tenantId, domain)
    .first();
  if (existing) return c.json({ error: "Tenant already exists" }, 409);
  await c.env.DB.prepare(
    "INSERT INTO tenants (tenant_id, name, domain, logo_url, theme_json, allowed_origins_json, features_json, rate_limits_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      tenantId,
      name,
      domain,
      typeof body?.logoUrl === "string" ? body.logoUrl : "",
      JSON.stringify(body?.theme ?? {}),
      JSON.stringify(body?.allowedOrigins ?? []),
      JSON.stringify(body?.features ?? {}),
      JSON.stringify(body?.rateLimits ?? {}),
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM tenants WHERE tenant_id = ?")
    .bind(tenantId)
    .first<Record<string, unknown>>();
  return c.json({ tenant: row ? tenantFromRow(row) : { tenantId, name, domain } }, 201);
});

adminRoutes.put("/tenants/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);
  const columns: Record<string, string> = {
    name: "name",
    domain: "domain",
    logoUrl: "logo_url",
    theme: "theme_json",
    allowedOrigins: "allowed_origins_json",
    features: "features_json",
    rateLimits: "rate_limits_json",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [field, col] of Object.entries(columns)) {
    if (!(field in body)) continue;
    const v = body[field];
    const isJson = col.endsWith("_json");
    if (!isJson && typeof v !== "string") return c.json({ error: `${field} must be a string` }, 400);
    sets.push(`${col} = ?`);
    values.push(isJson ? JSON.stringify(v) : v);
  }
  const existing = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE tenant_id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Tenant not found" }, 404);
  if (typeof body.domain === "string") {
    const clash = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE domain = ? AND tenant_id != ?")
      .bind(body.domain, id)
      .first();
    if (clash) return c.json({ error: "Domain already in use" }, 409);
  }
  if (sets.length > 0) {
    try {
      await c.env.DB.prepare(`UPDATE tenants SET ${sets.join(", ")}, updated_at = datetime('now') WHERE tenant_id = ?`)
        .bind(...values, id)
        .run();
    } catch (err) {
      if (err instanceof Error && /UNIQUE|constraint/i.test(err.message)) {
        return c.json({ error: "Domain already in use" }, 409);
      }
      throw err;
    }
  }
  const row = await c.env.DB.prepare("SELECT * FROM tenants WHERE tenant_id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json({ tenant: tenantFromRow(row!) });
});

adminRoutes.delete("/tenants/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE tenant_id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Tenant not found" }, 404);

  const storage = new TenantStorage(id, c.env);

  // Delete Vectorize vectors by iterating documents
  const docsPrefix = storage.r2Key("docs", "");
  let cursor: string | undefined;
  const vectorIdsToDelete: string[] = [];
  do {
    const listed = await c.env.PDF_BUCKET.list({ prefix: docsPrefix, cursor, include: ["customMetadata"] });
    for (const obj of listed.objects) {
      const filename = obj.key.slice(docsPrefix.length);
      if (!filename) continue;
      const chunkCount = Number(obj.customMetadata?.chunkCount ?? 0) || 0;
      for (let i = 0; i < chunkCount; i++) vectorIdsToDelete.push(storage.vectorId(filename, i));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  if (vectorIdsToDelete.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < vectorIdsToDelete.length; i += BATCH) {
      await c.env.VECTORIZE.deleteByIds(vectorIdsToDelete.slice(i, i + BATCH));
    }
  }

  // Delete all R2 objects
  const r2Prefix = `t/${id}/`;
  let r2Cursor: string | undefined;
  do {
    const listed = await c.env.PDF_BUCKET.list({ prefix: r2Prefix, cursor: r2Cursor });
    if (listed.objects.length > 0) await c.env.PDF_BUCKET.delete(listed.objects.map((o) => o.key));
    r2Cursor = listed.truncated ? listed.cursor : undefined;
  } while (r2Cursor);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM rate_limits WHERE tenant_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM question_paper_cache WHERE tenant_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM config WHERE tenant_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM transactions WHERE tenant_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM tenants WHERE tenant_id = ?").bind(id),
  ]);
  return c.json({ ok: true, deleted: { vectorIds: vectorIdsToDelete.length } });
});

adminRoutes.delete("/tenants/:id/purge-data", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT tenant_id FROM tenants WHERE tenant_id = ?").bind(id).first();
  if (!existing) return c.json({ error: "Tenant not found" }, 404);

  const storage = new TenantStorage(id, c.env);

  // Delete Vectorize vectors by iterating documents
  const docsPrefix = storage.r2Key("docs", "");
  let docsCursor: string | undefined;
  const vectorIdsToDelete: string[] = [];
  do {
    const listed = await c.env.PDF_BUCKET.list({ prefix: docsPrefix, cursor: docsCursor, include: ["customMetadata"] });
    for (const obj of listed.objects) {
      const filename = obj.key.slice(docsPrefix.length);
      if (!filename) continue;
      const chunkCount = Number(obj.customMetadata?.chunkCount ?? 0) || 0;
      for (let i = 0; i < chunkCount; i++) vectorIdsToDelete.push(storage.vectorId(filename, i));
    }
    docsCursor = listed.truncated ? listed.cursor : undefined;
  } while (docsCursor);

  if (vectorIdsToDelete.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < vectorIdsToDelete.length; i += BATCH) {
      await c.env.VECTORIZE.deleteByIds(vectorIdsToDelete.slice(i, i + BATCH));
    }
  }

  const del = async (table: string): Promise<number> => {
    const res = await c.env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(id).run();
    return res?.meta?.changes ?? 0;
  };
  const transactions = await del("transactions");
  const config = await del("config");
  const rateLimits = await del("rate_limits");
  await del("question_paper_cache");

  let r2Objects = 0;
  const prefix = `t/${id}/`;
  let cursor: string | undefined;
  do {
    const listed = await c.env.PDF_BUCKET.list({ prefix, cursor });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length > 0) {
      await c.env.PDF_BUCKET.delete(keys);
      r2Objects += keys.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return c.json({ ok: true, deleted: { transactions, config, rateLimits, r2Objects, vectorIds: vectorIdsToDelete.length } });
});

adminRoutes.get("/tenants/:id/stats", async (c) => {
  const id = c.req.param("id");
  const storage = new TenantStorage(id, c.env);
  let documentCount = 0;
  let cursor: string | undefined;
  do {
    const listed = await c.env.PDF_BUCKET.list({ prefix: storage.r2Key("docs", ""), cursor });
    documentCount += listed.objects.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  const stats = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count, MAX(created_at) AS last FROM transactions WHERE tenant_id = ?",
  )
    .bind(id)
    .first<{ count: number; last: string | null }>();
  return c.json({
    tenantId: id,
    documentCount,
    transactionCount: stats?.count ?? 0,
    lastActivity: stats?.last ?? null,
  });
});

adminRoutes.get("/documents", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const storage = new TenantStorage(id, c.env);
  const prefix = storage.r2Key("docs", "");
  const documents: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const listed = await c.env.PDF_BUCKET.list({ prefix, cursor, include: ["customMetadata"] });
    for (const obj of listed.objects) {
      const name = obj.key.slice(prefix.length);
      if (!name) continue;
      const meta = obj.customMetadata ?? {};
      documents.push({
        name,
        size: obj.size,
        uploaded: obj.uploaded,
        chunkCount: meta.chunkCount !== undefined ? Number(meta.chunkCount) : null,
        pageCount: meta.pageCount !== undefined ? Number(meta.pageCount) : null,
        indexedAt: meta.indexedAt ?? null,
        enriched: meta.enriched === "true",
        screenshotPages: meta.screenshotPages || null,
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return c.json({ documents });
});

adminRoutes.get("/documents/cleaned", async (c) => {
  const id = c.req.query("tenant_id");
  const name = c.req.query("name");
  if (!id || !name) return c.json({ error: "tenant_id and name required" }, 400);
  const storage = new TenantStorage(id, c.env);
  const safe = storage.sanitizeFilename(name);
  const obj = safe ? await c.env.PDF_BUCKET.get(storage.r2Key("cleaned", `${safe}.md`)) : null;
  if (!obj) return c.json({ error: "Not found" }, 404);
  return c.json({ name: safe, text: await obj.text() });
});

adminRoutes.get("/documents/chunks", async (c) => {
  const id = c.req.query("tenant_id");
  const name = c.req.query("name");
  if (!id || !name) return c.json({ error: "tenant_id and name required" }, 400);
  const storage = new TenantStorage(id, c.env);
  const safe = storage.sanitizeFilename(name);
  const obj = safe ? await c.env.PDF_BUCKET.get(storage.r2Key("cleaned", `${safe}.md`)) : null;
  if (!obj) return c.json({ error: "Not found" }, 404);
  const text = await obj.text();
  const pages = text.split(/^## Page (\d+)/m).slice(1);
  const parsed: Array<{ page: number; text: string }> = [];
  for (let i = 0; i < pages.length; i += 2) {
    parsed.push({ page: Number(pages[i]), text: (pages[i + 1] ?? "").trim() });
  }
  if (parsed.length === 0) parsed.push({ page: 1, text });
  const chunks = chunkText(parsed);
  return c.json({ name: safe, chunks: chunks.map((c) => ({ text: c.text, startPage: c.startPage, endPage: c.endPage, chunkIndex: c.chunkIndex })) });
});

adminRoutes.post("/documents/:name/reingest", async (c) => {
  const id = c.req.query("tenant_id") || c.req.header("X-Tenant");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const name = c.req.param("name");
  const storage = new TenantStorage(id, c.env);
  const safe = storage.sanitizeFilename(name);
  if (!safe) return c.json({ error: "Invalid filename" }, 400);

  const docKey = storage.r2Key("docs", safe);
  const obj = await c.env.PDF_BUCKET.get(docKey);
  if (!obj) return c.json({ error: "Document not found" }, 404);
  const pdfBytes = await obj.arrayBuffer();
  const oldChunkCount = Number(obj.customMetadata?.chunkCount ?? 0) || 0;

  let pages: Array<{ page: number; text: string }>;
  try {
    pages = await extractPdfPages(pdfBytes);
  } catch {
    return c.json({ error: "Could not read PDF" }, 422);
  }

  const config = await loadConfig(id, c.env.DB);
  let enrichedFullText: string | null = null;
  if (config.ingestionEnrichmentEnabled) {
    const enriched = await enrichPdfToMarkdown(pdfBytes, config, c.env);
    if (enriched) {
      const merged = parseEnrichedPages(enriched, pages);
      if (merged.some((p, i) => p.text !== pages[i].text)) {
        pages = merged;
        enrichedFullText = enriched;
      }
    }
  }

  const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5" as const;
  const chunks = config.chunkingMode === "semantic"
    ? await semanticChunkText(pages, async (texts) => {
        const out = (await c.env.AI.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
        return out.data ?? [];
      }, { semanticPercentile: config.semanticPercentile })
    : chunkText(pages);
  if (chunks.length === 0) return c.json({ error: "No extractable text in PDF" }, 422);

  const FIGURE_RE = /\[Figure:|Fig\.\s*\d|Figure\s+\d|diagram|illustration/i;
  const figurePageNumbers = pages.filter((p) => FIGURE_RE.test(p.text)).map((p) => p.page);
  console.log(`[reingest] ${safe}: ${pages.length} pages, figure pages: [${figurePageNumbers.join(",")}], pdfBytes: ${pdfBytes.byteLength}`);
  const screenshotResult = await captureAndStoreFigurePages(figurePageNumbers, pdfBytes, storage, safe, c.env, docKey);
  const pageImageKeys = screenshotResult.pageImageKeys;
  console.log(`[reingest] ${safe}: captured ${pageImageKeys.size} screenshots`, screenshotResult.warnings.length > 0 ? `warnings: ${screenshotResult.warnings.join("; ")}` : "");
  const BATCH = 100;
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const texts = chunks.slice(i, i + BATCH).map((ch) => ch.text);
    const out = (await c.env.AI.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
    if (!out.data || out.data.length !== texts.length) return c.json({ error: "Embedding failed" }, 502);
    embeddings.push(...out.data);
  }

  const vectors: VectorizeVector[] = chunks.map((chunk, i) => {
    const meta: Record<string, string> = {
      filename: safe,
      text: chunk.text,
      startPage: String(chunk.startPage),
      endPage: String(chunk.endPage),
      chunkIndex: String(chunk.chunkIndex),
      ...(chunk.section ? { section: chunk.section } : {}),
      ...(chunk.contentType ? { contentType: chunk.contentType } : {}),
    };
    const chunkFigurePages: number[] = [];
    for (let p = chunk.startPage; p <= chunk.endPage; p++) {
      if (pageImageKeys.has(p)) {
        meta.pageImageKey = pageImageKeys.get(p)!;
      }
      if (figurePageNumbers.includes(p)) {
        chunkFigurePages.push(p);
      }
    }
    if (chunkFigurePages.length > 0) {
      meta.figurePages = chunkFigurePages.join(",");
    }
    return {
      id: storage.vectorId(safe, chunk.chunkIndex),
      values: embeddings[i],
      metadata: storage.vectorMeta(meta),
    };
  });

  for (let i = 0; i < vectors.length; i += BATCH) {
    await c.env.VECTORIZE.upsert(vectors.slice(i, i + BATCH));
  }

  // Clean up stale vectors if chunk count decreased
  if (oldChunkCount > chunks.length) {
    const staleIds: string[] = [];
    for (let i = chunks.length; i < oldChunkCount; i++) staleIds.push(storage.vectorId(safe, i));
    for (let i = 0; i < staleIds.length; i += BATCH) {
      await c.env.VECTORIZE.deleteByIds(staleIds.slice(i, i + BATCH));
    }
  }

  const enriched = enrichedFullText !== null;
  await c.env.PDF_BUCKET.put(docKey, pdfBytes, {
    customMetadata: {
      chunkCount: String(chunks.length),
      pageCount: String(pages.length),
      indexedAt: new Date().toISOString(),
      enriched: String(enriched),
      screenshotPages: pageImageKeys.size > 0 ? Array.from(pageImageKeys.keys()).join(",") : "",
    },
  });
  if (enriched) await c.env.PDF_BUCKET.put(storage.r2Key("cleaned", safe + ".md"), enrichedFullText!);

  return c.json({
    success: true,
    filename: safe,
    chunkCount: chunks.length,
    pageCount: pages.length,
    enriched,
    screenshotsCaptured: pageImageKeys.size,
    ...(screenshotResult.warnings.length > 0 ? { screenshotWarnings: screenshotResult.warnings } : {}),
  });
});

adminRoutes.post("/documents/:name/screenshots", async (c) => {
  const id = c.req.query("tenant_id") || c.req.header("X-Tenant");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const name = c.req.param("name");
  const storage = new TenantStorage(id, c.env);
  const safe = storage.sanitizeFilename(name);
  if (!safe) return c.json({ error: "Invalid filename" }, 400);

  const docKey = storage.r2Key("docs", safe);
  const obj = await c.env.PDF_BUCKET.get(docKey);
  if (!obj) return c.json({ error: "Document not found" }, 404);
  const pdfBytes = await obj.arrayBuffer();
  const existingMeta = obj.customMetadata ?? {};

  // Get enriched text to find figure pages
  const cleanedObj = await c.env.PDF_BUCKET.get(storage.r2Key("cleaned", safe + ".md"));
  let pages: Array<{ page: number; text: string }>;
  if (cleanedObj) {
    const text = await cleanedObj.text();
    const markers = [...text.matchAll(/<<<PAGE\s+(\d+)>>>/g)];
    if (markers.length > 0) {
      pages = markers.map((m, i) => ({
        page: Number(m[1]),
        text: text.slice(m.index! + m[0].length, markers[i + 1]?.index ?? text.length).trim(),
      }));
    } else {
      try { pages = await extractPdfPages(pdfBytes); } catch { return c.json({ error: "Could not read PDF" }, 422); }
    }
  } else {
    try { pages = await extractPdfPages(pdfBytes); } catch { return c.json({ error: "Could not read PDF" }, 422); }
  }

  const FIGURE_RE = /\[Figure:|Fig\.\s*\d|Figure\s+\d|diagram|illustration/i;
  const figurePageNumbers = pages.filter((p) => FIGURE_RE.test(p.text)).map((p) => p.page);
  if (figurePageNumbers.length === 0) return c.json({ success: true, screenshotsCaptured: 0, message: "No figure pages detected" });

  console.log(`[screenshots-retry] ${safe}: figure pages [${figurePageNumbers.join(",")}], PDF ${pdfBytes.byteLength}B`);
  const screenshotResult = await captureAndStoreFigurePages(figurePageNumbers, pdfBytes, storage, safe, c.env);
  const pageImageKeys = screenshotResult.pageImageKeys;

  // Update R2 metadata with new screenshot pages
  if (pageImageKeys.size > 0) {
    const allScreenshots = new Set<number>();
    if (existingMeta.screenshotPages) {
      for (const p of existingMeta.screenshotPages.split(",")) {
        const n = Number(p);
        if (n > 0) allScreenshots.add(n);
      }
    }
    for (const p of pageImageKeys.keys()) allScreenshots.add(p);
    await c.env.PDF_BUCKET.put(docKey, pdfBytes, {
      customMetadata: { ...existingMeta, screenshotPages: Array.from(allScreenshots).sort((a, b) => a - b).join(",") },
    });

    // Update vectors with pageImageKey metadata
    const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5" as const;
    const chunkCount = Number(existingMeta.chunkCount ?? 0) || 0;
    if (chunkCount > 0) {
      const BATCH = 100;
      const vectorIds: string[] = [];
      for (let i = 0; i < chunkCount; i++) vectorIds.push(storage.vectorId(safe, i));

      // Query existing vectors to get their metadata and values
      for (let i = 0; i < vectorIds.length; i += BATCH) {
        const batchIds = vectorIds.slice(i, i + BATCH);
        const fetched = await c.env.VECTORIZE.getByIds(batchIds);
        if (!fetched || fetched.length === 0) continue;
        const toUpdate: VectorizeVector[] = [];
        for (const vec of fetched) {
          const meta = (vec.metadata ?? {}) as Record<string, string>;
          const startPage = Number(meta.startPage ?? 0);
          const endPage = Number(meta.endPage ?? startPage);
          let matched = false;
          for (let p = startPage; p <= endPage; p++) {
            if (pageImageKeys.has(p)) {
              meta.pageImageKey = pageImageKeys.get(p)!;
              matched = true;
              break;
            }
          }
          if (matched && vec.values) {
            toUpdate.push({ id: vec.id, values: vec.values as number[], metadata: storage.vectorMeta(meta) });
          }
        }
        if (toUpdate.length > 0) await c.env.VECTORIZE.upsert(toUpdate);
      }
    }
  }

  return c.json({
    success: true,
    screenshotsCaptured: pageImageKeys.size,
    figurePages: figurePageNumbers,
    ...(screenshotResult.warnings.length > 0 ? { screenshotWarnings: screenshotResult.warnings } : {}),
  });
});

adminRoutes.get("/transactions", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
  const since = c.req.query("since");
  let sql = "SELECT * FROM transactions WHERE tenant_id = ?";
  const binds: unknown[] = [id];
  if (since) {
    sql += " AND created_at >= ?";
    binds.push(since);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  binds.push(limit);
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ transactions: results ?? [] });
});

adminRoutes.get("/costing", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const since = c.req.query("since");
  let sql = "SELECT provider, model, COUNT(*) AS requests, COALESCE(SUM(token_estimate), 0) AS tokens, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens FROM transactions WHERE tenant_id = ?";
  const binds: unknown[] = [id];
  if (since) {
    sql += " AND created_at >= ?";
    binds.push(since);
  }
  sql += " GROUP BY provider, model";
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<{ provider: string | null; model: string | null; requests: number; tokens: number; input_tokens: number; output_tokens: number }>();
  const breakdown = results ?? [];
  return c.json({
    totalRequests: breakdown.reduce((s, r) => s + r.requests, 0),
    totalTokens: breakdown.reduce((s, r) => s + r.tokens, 0),
    totalInputTokens: breakdown.reduce((s, r) => s + r.input_tokens, 0),
    totalOutputTokens: breakdown.reduce((s, r) => s + r.output_tokens, 0),
    breakdown,
  });
});

adminRoutes.post("/relevance-check", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    tenant_id?: string;
    query?: string;
    top_k?: number;
  } | null;
  if (!body?.tenant_id || !body?.query) return c.json({ error: "tenant_id and query required" }, 400);

  const storage = new TenantStorage(body.tenant_id, c.env);
  const topK = Math.min(Math.max(body.top_k ?? 10, 1), 20);

  const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
  const embedOut = (await c.env.AI.run(EMBED_MODEL, { text: [body.query] })) as { data?: number[][] };
  if (!embedOut.data?.[0]) return c.json({ error: "Embedding failed" }, 502);

  const queried = await c.env.VECTORIZE.query(embedOut.data[0], {
    topK,
    filter: storage.vectorFilter(),
    returnMetadata: "all",
  });

  const retrieved = (queried?.matches ?? []).map((m) => {
    const meta = (m.metadata ?? {}) as Record<string, string>;
    return { ...meta, id: m.id, score: m.score, text: String(meta.text ?? "") };
  });

  const reranked = await rerank(body.query, retrieved, c.env);

  const results = reranked.map((c: any, i: number) => ({
    rank: i + 1,
    filename: c.filename ?? "unknown",
    page: c.startPage ?? c.page ?? "?",
    chunkIndex: c.chunkIndex ?? "?",
    cosine: Number(c.score).toFixed(4),
    rerank: typeof c.rerankScore === "number" ? c.rerankScore.toFixed(4) : null,
    textPreview: String(c.text).slice(0, 200),
  }));

  return c.json({
    query: body.query,
    tenantId: body.tenant_id,
    totalRetrieved: retrieved.length,
    rerankWorking: reranked.some((c: any) => typeof c.rerankScore === "number"),
    results,
  });
});

adminRoutes.get("/config", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  return c.json({ config: await loadConfig(id, c.env.DB) });
});

adminRoutes.put("/config", async (c) => {
  const id = c.req.query("tenant_id");
  if (!id) return c.json({ error: "tenant_id required" }, 400);
  const body = (await c.req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!body || typeof body.key !== "string" || !Object.prototype.hasOwnProperty.call(DEFAULTS, body.key)) {
    return c.json({ error: "Unknown config key" }, 400);
  }
  if (body.value === undefined || body.value === null || typeof body.value === "object") {
    return c.json({ error: "value must be a string, number or boolean" }, 400);
  }
  const value = String(body.value);
  if (!validateConfigValue(body.key as keyof typeof DEFAULTS, value)) {
    return c.json({ error: `Invalid value for ${body.key}` }, 400);
  }
  await saveConfigField(id, c.env.DB, body.key, value);
  return c.json({ config: await loadConfig(id, c.env.DB) });
});
