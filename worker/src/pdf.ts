import { getDocumentProxy } from "unpdf";

export async function extractPdfPages(pdfBytes: ArrayBuffer): Promise<Array<{ page: number; text: string }>> {
  // PDF.js transfers (detaches) the buffer it is given; copy so callers can keep using theirs.
  const pdf = await getDocumentProxy(new Uint8Array(pdfBytes.slice(0)));
  const pages: Array<{ page: number; text: string }> = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const content = await p.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ page: i, text });
  }
  return pages;
}
