import { describe, it, expect } from "vitest";
import { extractPdfPages } from "../src/pdf";

describe("extractPdfPages", () => {
  it("copies buffer before passing to PDF.js (buffer should not be detached)", async () => {
    const buf = new ArrayBuffer(8);
    try {
      await extractPdfPages(buf);
    } catch {
      // invalid PDF throws; buffer must still not be detached
    }
    expect(buf.byteLength).toBe(8);
  });
});
