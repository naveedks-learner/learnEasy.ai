import { describe, it, expect } from "vitest";
import { extractPdfPages } from "../src/pdf";

function buildPdf(pageTexts: string[]): ArrayBuffer {
  const objs: string[] = [];
  const n = pageTexts.length;
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${pageTexts.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`);
  const fontId = 3 + n * 2;
  pageTexts.forEach((t, i) => {
    const stream = `BT /F1 12 Tf 20 100 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer as ArrayBuffer;
}

describe("extractPdfPages", () => {
  it("extracts {page, text} for each page of a valid PDF", async () => {
    const pages = await extractPdfPages(buildPdf(["Hello world", "Second page"]));
    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[0].text).toContain("Hello world");
    expect(pages[1].page).toBe(2);
    expect(pages[1].text).toContain("Second page");
  });

  it("does not detach the caller's buffer after a real extraction", async () => {
    const buf = buildPdf(["Some text"]);
    const size = buf.byteLength;
    const pages = await extractPdfPages(buf);
    expect(pages[0].text).toContain("Some text");
    expect(buf.byteLength).toBe(size);
    expect(new Uint8Array(buf)[0]).toBe(0x25);
  });

  it("does not detach the buffer when the PDF is invalid", async () => {
    const buf = new ArrayBuffer(8);
    await expect(extractPdfPages(buf)).rejects.toThrow();
    expect(buf.byteLength).toBe(8);
  });
});
