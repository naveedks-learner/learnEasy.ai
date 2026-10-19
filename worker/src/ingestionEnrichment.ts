import type { Env } from "./env";
import type { RuntimeConfig } from "./config";

type Page = { page: number; text: string };

const ENRICH_PROMPT =
  "Convert this PDF to Markdown. Re-emit every page, in order. Begin each page with a marker line " +
  "`<<<PAGE n>>>` using the real page number. Write formulas as LaTeX, tables as Markdown tables, " +
  "and tag every figure or diagram as `[Figure: description]`. Output only the Markdown.";

function toBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < arr.length; i += step) {
    bin += String.fromCharCode(...arr.subarray(i, i + step));
  }
  return btoa(bin);
}

// Fails open: any error yields null so ingestion falls back to plain text.
export async function enrichPdfToMarkdown(
  pdfBytes: ArrayBuffer,
  config: RuntimeConfig,
  env: Env,
): Promise<string | null> {
  if (!config.ingestionEnrichmentEnabled) return null;
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.ingestionModelSlug,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: ENRICH_PROMPT },
              {
                type: "file",
                file: {
                  filename: "document.pdf",
                  file_data: `data:application/pdf;base64,${toBase64(pdfBytes)}`,
                },
              },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() !== "" ? text : null;
  } catch {
    return null;
  }
}

// Merges by page label, not position; never throws.
export function parseEnrichedPages(enrichedText: string, plainPages: Page[]): Page[] {
  try {
    if (typeof enrichedText !== "string" || enrichedText === "") return plainPages;
    const byPage = new Map<number, string>();
    const re = /<<<PAGE\s+(\d+)>>>/g;
    const markers: Array<{ page: number; start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(enrichedText)) !== null) {
      markers.push({ page: Number(m[1]), start: m.index, end: m.index + m[0].length });
    }
    if (markers.length === 0) return plainPages;
    markers.forEach((mk, i) => {
      const body = enrichedText.slice(mk.end, markers[i + 1]?.start ?? enrichedText.length).trim();
      if (body !== "" && !byPage.has(mk.page)) byPage.set(mk.page, body);
    });
    return plainPages.map((p) => ({ page: p.page, text: byPage.get(p.page) ?? p.text }));
  } catch {
    return plainPages;
  }
}
