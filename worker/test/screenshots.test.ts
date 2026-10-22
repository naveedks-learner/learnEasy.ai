import { describe, it, expect } from "vitest";
import { captureAndStoreFigurePages } from "../src/screenshots";

function makeStorage(tenantId = "t1") {
  return {
    tenantId,
    r2Key: (...parts: string[]) => `t/${tenantId}/${parts.join("/")}`,
  } as any;
}

describe("captureAndStoreFigurePages", () => {
  it("returns empty map when no figure pages", async () => {
    const result = await captureAndStoreFigurePages([], new ArrayBuffer(0), makeStorage(), "test.pdf", {} as any);
    expect(result.pageImageKeys.size).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("fails open when browser launch fails (no real browser in test)", async () => {
    const result = await captureAndStoreFigurePages([2, 5], new ArrayBuffer(100), makeStorage(), "bio.pdf", {} as any);
    expect(result.pageImageKeys.size).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
