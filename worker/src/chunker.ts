export interface Chunk {
  text: string;
  startPage: number;
  endPage: number;
  chunkIndex: number;
  pageImageKey?: string;
}

interface Word { word: string; page: number }

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
  const step = Math.max(1, chunkSize - overlap);

  const allWords: Word[] = [];
  const figurePages = new Set<number>();
  const allLines: string[] = [];
  const wordToLine: number[] = [];

  for (const { page, text } of pages) {
    if (text.includes("[Figure:")) figurePages.add(page);
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

    // If the split point lands inside a table, extend to include the full table
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

    // Compute next position with overlap, but don't start inside a table
    let nextPos = end - overlap;
    if (nextPos <= pos) nextPos = end;
    const nextTable = isInsideTable(nextPos);
    if (nextTable) nextPos = nextTable[0];
    if (nextPos <= pos) nextPos = end;

    pos = nextPos;
  }
  return chunks;
}
