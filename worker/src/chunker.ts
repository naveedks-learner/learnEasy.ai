export interface Chunk {
  text: string;
  startPage: number;
  endPage: number;
  chunkIndex: number;
  pageImageKey?: string;
  section?: string;
  contentType?: string;
}

interface Word { word: string; page: number }

/* ── Structure-aware semantic chunking ─────────────────────────── */

interface Section {
  heading: string | null;
  blocks: Block[];
  page: number;
}

interface Block {
  text: string;
  page: number;
  wordCount: number;
  atomic: boolean;
  contentType: string;
}

const HEADING_RE = /^#{1,4}\s+.+/;
const DISPLAY_MATH_RE = /\$\$[\s\S]+?\$\$/;
const EXAMPLE_RE = /^(?:Example|Worked Example|Illustration|Sample Problem|Solved Example)\s*[\d.:]/im;
const PROOF_RE = /^(?:Proof|Solution|Derivation)\s*[.:]/im;
const EXERCISE_RE = /^(?:Exercise|Q\.|Question)\s*[\d.:]/im;
const FIGURE_RE = /\[Figure:|Fig\.\s*\d|Figure\s+\d|diagram|illustration/i;

function classifyBlock(text: string): { atomic: boolean; contentType: string } {
  if (DISPLAY_MATH_RE.test(text) && text.split(/\$\$/).length >= 3) {
    return { atomic: true, contentType: "equation" };
  }
  if (PROOF_RE.test(text)) return { atomic: true, contentType: "proof" };
  if (EXAMPLE_RE.test(text)) return { atomic: true, contentType: "worked_example" };
  if (EXERCISE_RE.test(text)) return { atomic: true, contentType: "exercise" };
  if (text.includes("|") && /^\|?\s*:?-{2,}/.test(text.split("\n").find((l) => l.includes("---")) ?? "")) {
    return { atomic: true, contentType: "table" };
  }
  return { atomic: false, contentType: "prose" };
}

function splitIntoSections(pages: Array<{ page: number; text: string }>): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: null, blocks: [], page: pages[0]?.page ?? 1 };

  for (const { page, text } of pages) {
    const lines = text.split("\n");
    let buffer = "";

    const flushBuffer = () => {
      const trimmed = buffer.trim();
      if (!trimmed) { buffer = ""; return; }
      const { atomic, contentType } = classifyBlock(trimmed);
      current.blocks.push({
        text: trimmed, page, atomic, contentType,
        wordCount: trimmed.split(/\s+/).length,
      });
      buffer = "";
    };

    for (const line of lines) {
      if (HEADING_RE.test(line.trim())) {
        flushBuffer();
        if (current.blocks.length > 0) {
          sections.push(current);
        }
        current = { heading: line.trim().replace(/^#+\s+/, ""), blocks: [], page };
        continue;
      }

      const lineClassified = classifyBlock(line.trim());
      if (lineClassified.atomic && buffer.trim()) {
        flushBuffer();
      }

      buffer += (buffer ? "\n" : "") + line;

      if (lineClassified.atomic) {
        flushBuffer();
      }
    }
    flushBuffer();
  }

  if (current.blocks.length > 0) sections.push(current);
  return sections;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function percentileThreshold(similarities: number[], percentile: number): number {
  if (similarities.length === 0) return 0;
  const sorted = [...similarities].sort((a, b) => a - b);
  const idx = Math.floor((percentile / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export interface SemanticChunkOpts {
  minChunkWords?: number;
  maxChunkWords?: number;
  semanticPercentile?: number;
  embedBatch?: number;
}

async function semanticSplitBlocks(
  blocks: Block[],
  embedFn: (texts: string[]) => Promise<number[][]>,
  opts: SemanticChunkOpts,
): Promise<Block[][]> {
  const minWords = opts.minChunkWords ?? 80;
  const maxWords = opts.maxChunkWords ?? 400;
  const percentile = opts.semanticPercentile ?? 93;
  const batchSize = opts.embedBatch ?? 100;

  const nonAtomic: { block: Block; idx: number }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i].atomic) nonAtomic.push({ block: blocks[i], idx: i });
  }

  const embeddings = new Map<number, number[]>();
  for (let i = 0; i < nonAtomic.length; i += batchSize) {
    const batch = nonAtomic.slice(i, i + batchSize);
    const vecs = await embedFn(batch.map((b) => b.block.text));
    for (let j = 0; j < batch.length; j++) {
      embeddings.set(batch[j].idx, vecs[j]);
    }
  }

  const similarities: { sim: number; afterIdx: number }[] = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const ea = embeddings.get(i);
    const eb = embeddings.get(i + 1);
    if (ea && eb) {
      similarities.push({ sim: cosine(ea, eb), afterIdx: i });
    }
  }

  const splitThreshold = similarities.length > 0
    ? percentileThreshold(similarities.map((s) => s.sim), 100 - percentile)
    : 0;

  const semanticBreaks = new Set<number>();
  for (const { sim, afterIdx } of similarities) {
    if (sim <= splitThreshold) semanticBreaks.add(afterIdx + 1);
  }

  const groups: Block[][] = [];
  let group: Block[] = [];
  let groupWords = 0;

  const flush = () => {
    if (group.length > 0) { groups.push(group); group = []; groupWords = 0; }
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    if (b.atomic) {
      if (groupWords + b.wordCount > maxWords && group.length > 0) flush();
      group.push(b);
      groupWords += b.wordCount;
      if (groupWords >= minWords && i + 1 < blocks.length) {
        const next = blocks[i + 1];
        if (next.atomic || semanticBreaks.has(i + 1)) flush();
      }
      continue;
    }

    if (groupWords + b.wordCount > maxWords && group.length > 0) {
      flush();
    }

    if (semanticBreaks.has(i) && groupWords >= minWords && group.length > 0) {
      flush();
    }

    group.push(b);
    groupWords += b.wordCount;
  }
  flush();

  return groups;
}

export async function semanticChunkText(
  pages: Array<{ page: number; text: string }>,
  embedFn: (texts: string[]) => Promise<number[][]>,
  opts: SemanticChunkOpts = {},
): Promise<Chunk[]> {
  const sections = splitIntoSections(pages);
  if (sections.length === 0) return [];

  const figurePages = new Set<number>();
  for (const { page, text } of pages) {
    if (FIGURE_RE.test(text)) figurePages.add(page);
  }

  const allChunks: Chunk[] = [];

  for (const section of sections) {
    if (section.blocks.length === 0) continue;

    const groups = section.blocks.length === 1
      ? [section.blocks]
      : await semanticSplitBlocks(section.blocks, embedFn, opts);

    for (const group of groups) {
      const text = group.map((b) => b.text).join("\n\n");
      const startPage = group[0].page;
      const endPage = group[group.length - 1].page;
      const primaryType = group.find((b) => b.contentType !== "prose")?.contentType ?? "prose";

      const chunk: Chunk = {
        text,
        startPage,
        endPage,
        chunkIndex: allChunks.length,
        ...(section.heading ? { section: section.heading } : {}),
        ...(primaryType !== "prose" ? { contentType: primaryType } : {}),
      };

      for (let p = startPage; p <= endPage; p++) {
        if (figurePages.has(p)) { chunk.pageImageKey = `${p}.png`; break; }
      }

      allChunks.push(chunk);
    }
  }

  return allChunks;
}

/* ── Fixed-length chunking (original) ─────────────────────────── */

/**
 * Detects Markdown table blocks in a word stream and returns index ranges
 * that should not be split. A table block starts with a line containing `|`
 * followed by a separator line (`|---|---|`), and ends when a line no longer
 * starts with `|`.
 */
function findTableRanges(words: Word[], wordToLine: number[], lines: string[]): Array<[number, number]> {
  const tableLinesSet = new Set<number>();
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes("|") && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      let start = i;
      let end = i + 1;
      while (end + 1 < lines.length && lines[end + 1].trim().startsWith("|")) end++;
      for (let l = start; l <= end; l++) tableLinesSet.add(l);
    }
  }
  if (tableLinesSet.size === 0) return [];

  const ranges: Array<[number, number]> = [];
  let rangeStart = -1;
  for (let wi = 0; wi < words.length; wi++) {
    const inTable = tableLinesSet.has(wordToLine[wi]);
    if (inTable && rangeStart === -1) rangeStart = wi;
    if (!inTable && rangeStart !== -1) {
      ranges.push([rangeStart, wi - 1]);
      rangeStart = -1;
    }
  }
  if (rangeStart !== -1) ranges.push([rangeStart, words.length - 1]);
  return ranges;
}

export function chunkText(
  pages: Array<{ page: number; text: string }>,
  opts: { chunkSize?: number; overlap?: number } = {},
): Chunk[] {
  const chunkSize = opts.chunkSize ?? 300;
  const overlap = opts.overlap ?? 50;

  const allWords: Word[] = [];
  const figurePages = new Set<number>();
  const allLines: string[] = [];
  const wordToLine: number[] = [];

  for (const { page, text } of pages) {
    if (/\[Figure:|Fig\.\s*\d|Figure\s+\d|diagram|illustration/i.test(text)) {
      figurePages.add(page);
    }
    const lines = text.split("\n");
    for (const line of lines) {
      const lineIdx = allLines.length;
      allLines.push(line);
      for (const w of line.split(/\s+/)) {
        if (!w) continue;
        allWords.push({ word: w, page });
        wordToLine.push(lineIdx);
      }
    }
  }

  if (allWords.length === 0) return [];

  const tableRanges = findTableRanges(allWords, wordToLine, allLines);

  function isInsideTable(idx: number): [number, number] | null {
    for (const [s, e] of tableRanges) {
      if (idx >= s && idx <= e) return [s, e];
    }
    return null;
  }

  const chunks: Chunk[] = [];
  let pos = 0;

  while (pos < allWords.length) {
    let end = Math.min(pos + chunkSize, allWords.length);

    if (end < allWords.length) {
      const tableRange = isInsideTable(end);
      if (tableRange) {
        end = Math.min(tableRange[1] + 1, allWords.length);
      }
    }

    const startPage = allWords[pos].page;
    const endPage = allWords[end - 1].page;
    const text = allWords.slice(pos, end).map((w) => w.word).join(" ");

    const chunk: Chunk = { text, startPage, endPage, chunkIndex: chunks.length };
    for (let p = startPage; p <= endPage; p++) {
      if (figurePages.has(p)) {
        chunk.pageImageKey = `${p}.png`;
        break;
      }
    }
    chunks.push(chunk);

    if (end >= allWords.length) break;

    let nextPos = end - overlap;
    if (nextPos <= pos) nextPos = end;
    const nextTable = isInsideTable(nextPos);
    if (nextTable) nextPos = nextTable[0];
    if (nextPos <= pos) nextPos = end;

    pos = nextPos;
  }
  return chunks;
}
