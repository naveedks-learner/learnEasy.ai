import puppeteer, { type Browser } from "@cloudflare/puppeteer";
import type { Env } from "./env";
import type { TenantStorage } from "./storage";

const MIN_PLAUSIBLE_SCREENSHOT_BYTES = 4000;
const DATA_URL_SAFE_BYTES = 1_200_000;

export async function launchScreenshotBrowser(env: Env): Promise<Browser | null> {
  try {
    return await puppeteer.launch(env.BROWSER);
  } catch (err) {
    console.error("[screenshots] browser launch failed", err);
    return null;
  }
}

async function capturePageScreenshot(
  browser: Browser,
  pdfBytes: ArrayBuffer,
  pageNumber: number,
): Promise<ArrayBuffer | null> {
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754 });

    const b64 = Buffer.from(new Uint8Array(pdfBytes)).toString("base64");
    if (pdfBytes.byteLength <= DATA_URL_SAFE_BYTES) {
      const dataUrl = `data:application/pdf;base64,${b64}#page=${pageNumber}&zoom=page-fit&toolbar=0&navpanes=0&statusbar=0`;
      await page.goto(dataUrl, { waitUntil: "networkidle0" });
    } else {
      await page.goto("about:blank");
      await page.evaluate((b64Str: string, pg: number) => {
        const binary = atob(b64Str);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        document.body.style.margin = "0";
        document.body.style.overflow = "hidden";
        const embed = document.createElement("embed");
        embed.src = `${url}#page=${pg}&zoom=page-fit&toolbar=0&navpanes=0&statusbar=0`;
        embed.type = "application/pdf";
        embed.style.width = "1240px";
        embed.style.height = "1754px";
        embed.style.border = "none";
        document.body.appendChild(embed);
      }, b64, pageNumber);
      await new Promise((r) => setTimeout(r, 3000));
    }

    const screenshot = (await page.screenshot()) as Uint8Array;
    console.log(`[screenshots] page ${pageNumber}: ${screenshot.byteLength} bytes`);
    if (screenshot.byteLength < MIN_PLAUSIBLE_SCREENSHOT_BYTES) {
      console.error(`[screenshots] page ${pageNumber} blank — discarding`);
      return null;
    }
    return screenshot as unknown as ArrayBuffer;
  } catch (err) {
    console.error(`[screenshots] page ${pageNumber} failed:`, String(err));
    return null;
  } finally {
    await page?.close().catch(() => {});
  }
}

export interface ScreenshotResult {
  pageImageKeys: Map<number, string>;
  warnings: string[];
}

export async function captureAndStoreFigurePages(
  figurePageNumbers: number[],
  pdfBytes: ArrayBuffer,
  storage: TenantStorage,
  filename: string,
  env: Env,
  _r2DocKey?: string,
): Promise<ScreenshotResult> {
  const pageImageKeys = new Map<number, string>();
  const warnings: string[] = [];
  if (figurePageNumbers.length === 0) return { pageImageKeys, warnings };

  const browser = await launchScreenshotBrowser(env);
  if (!browser) {
    warnings.push("Browser launch failed — screenshot quota may be exhausted (resets daily)");
    return { pageImageKeys, warnings };
  }

  try {
    console.log(`[screenshots] PDF ${pdfBytes.byteLength}B, method: ${pdfBytes.byteLength <= DATA_URL_SAFE_BYTES ? "dataUrl" : "blobUrl"}, pages: ${figurePageNumbers.length}`);
    for (const pageNumber of figurePageNumbers) {
      const screenshot = await capturePageScreenshot(browser, pdfBytes, pageNumber);
      if (!screenshot) {
        warnings.push(`Page ${pageNumber}: screenshot was blank or failed`);
        continue;
      }
      const key = storage.r2Key("images", filename, `${pageNumber}.png`);
      await env.PDF_BUCKET.put(key, screenshot, {
        httpMetadata: { contentType: "image/png" },
      });
      pageImageKeys.set(pageNumber, `${filename}/${pageNumber}.png`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { pageImageKeys, warnings };
}
