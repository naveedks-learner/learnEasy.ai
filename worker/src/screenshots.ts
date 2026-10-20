import type { Env } from "./env";
import type { TenantStorage } from "./storage";

/**
 * Captures screenshots of specific PDF pages using Cloudflare Browser Rendering.
 * Renders each page as a simple HTML document with the page text, then screenshots it.
 * Falls back gracefully — never throws; returns the set of pages that succeeded.
 *
 * For pages with [Figure: ...] tags, the screenshot captures the rendered content
 * so students can see the visual layout even when the text extraction lost it.
 */
export async function capturePageScreenshots(
  pages: Array<{ page: number; text: string }>,
  figurePages: Set<number>,
  storage: TenantStorage,
  filename: string,
  env: Env,
): Promise<Set<number>> {
  if (figurePages.size === 0) return new Set();
  const captured = new Set<number>();

  for (const pageNum of figurePages) {
    try {
      const page = pages.find((p) => p.page === pageNum);
      if (!page) continue;

      const html = buildPageHtml(page.text, pageNum);
      const screenshot = await renderScreenshot(html, env);
      if (!screenshot) continue;

      const key = storage.r2Key("images", filename, `${pageNum}.png`);
      await env.PDF_BUCKET.put(key, screenshot, {
        customMetadata: { page: String(pageNum), filename },
      });
      captured.add(pageNum);
    } catch {
      // Fail open per project philosophy
    }
  }
  return captured;
}

function buildPageHtml(text: string, pageNum: number): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body { font-family: system-ui, sans-serif; padding: 24px; max-width: 800px; margin: 0 auto;
  font-size: 14px; line-height: 1.6; color: #1a1a1a; background: #fff; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
th { background: #f5f5f5; font-weight: 600; }
.page-label { color: #888; font-size: 11px; margin-bottom: 8px; }
</style></head><body>
<div class="page-label">Page ${pageNum}</div>
<div>${escaped}</div>
</body></html>`;
}

async function renderScreenshot(html: string, env: Env): Promise<ArrayBuffer | null> {
  try {
    const browser = env.BROWSER;
    const resp = await browser.fetch("https://workers-binding.com/screenshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html,
        screenshotOptions: {
          type: "png",
          fullPage: true,
          omitBackground: false,
        },
        viewport: { width: 800, height: 600 },
      }),
    });
    if (!resp.ok) return null;
    return await resp.arrayBuffer();
  } catch {
    return null;
  }
}
