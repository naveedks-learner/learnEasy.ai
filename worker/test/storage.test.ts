import { describe, it, expect } from "vitest";
import { TenantStorage } from "../src/storage";

describe("TenantStorage", () => {
  const s = new TenantStorage("school-a", {} as any);

  it("prefixes R2 keys with tenant namespace", () => {
    expect(s.r2Key("docs", "physics.pdf")).toBe("t/school-a/docs/physics.pdf");
    expect(s.r2Key("images", "physics.pdf", "3.png")).toBe("t/school-a/images/physics.pdf/3.png");
    expect(s.r2Key("cleaned", "physics.pdf.md")).toBe("t/school-a/cleaned/physics.pdf.md");
  });

  it("produces deterministic vector IDs scoped by tenant", () => {
    const id1 = s.vectorId("physics.pdf", 0);
    const id2 = s.vectorId("physics.pdf", 1);
    expect(id1).not.toBe(id2);
    expect(id1).toContain("::0");
    expect(s.vectorId("physics.pdf", 0)).toBe(id1);
    expect(id1).toMatch(/^[0-9a-f]{16}::0$/);
    const s2 = new TenantStorage("school-b", {} as any);
    expect(s2.vectorId("physics.pdf", 0)).not.toBe(id1);
  });

  it("matches the real SHA-256 prefix", async () => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("school-aphysics.pdf"));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(s.vectorId("physics.pdf", 7)).toBe(`${hex.slice(0, 16)}::7`);
  });

  it("always includes tenantId in vector metadata", () => {
    expect(s.vectorMeta({ filename: "x.pdf" })).toEqual({ tenantId: "school-a", filename: "x.pdf" });
  });

  it("returns tenant filter for Vectorize queries", () => {
    expect(s.vectorFilter()).toEqual({ tenantId: "school-a" });
  });

  it("sanitizes filenames to prevent path traversal", () => {
    expect(s.sanitizeFilename("../../etc/passwd")).not.toContain("..");
    expect(s.sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(s.sanitizeFilename("normal-file.pdf")).toBe("normal-file.pdf");
    expect(s.sanitizeFilename("path/to/file.pdf")).toBe("pathtofile.pdf");
    expect(s.sanitizeFilename("a\\b\0c.pdf")).toBe("abc.pdf");
  });
});
