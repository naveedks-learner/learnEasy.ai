export interface Chunk {
  text: string;
  startPage: number;
  endPage: number;
  chunkIndex: number;
  pageImageKey?: string;
}

/**
 * pageImageKey is relative ("<page>.png"); the caller prefixes it with the tenant-scoped
 * image location since the chunker knows nothing about filenames or tenants.
 */
export function chunkText(
  pages: Array<{ page: number; text: string }>,
  opts: { chunkSize?: number; overlap?: number } = {},
): Chunk[] {
  const chunkSize = opts.chunkSize ?? 300;
  const overlap = opts.overlap ?? 50;
  const step = Math.max(1, chunkSize - overlap);

  const words: string[] = [];
  const wordPage: number[] = [];
  const figurePages = new Set<number>();
  for (const { page, text } of pages) {
    if (text.includes("[Figure:")) figurePages.add(page);
    for (const w of text.split(/\s+/)) {
      if (!w) continue;
      words.push(w);
      wordPage.push(page);
    }
  }

  const chunks: Chunk[] = [];
  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + chunkSize, words.length);
    const startPage = wordPage[start];
    const endPage = wordPage[end - 1];
    const chunk: Chunk = { text: words.slice(start, end).join(" "), startPage, endPage, chunkIndex: chunks.length };
    for (let p = startPage; p <= endPage; p++) {
      if (figurePages.has(p)) {
        chunk.pageImageKey = `${p}.png`;
        break;
      }
    }
    chunks.push(chunk);
    if (end === words.length) break;
  }
  return chunks;
}
