import { describe, expect, it } from "vitest";
import { buildQuotePdfDownloadFilename } from "@/lib/quotes/pdf/filename";

describe("buildQuotePdfDownloadFilename", () => {
  it("a plain quote number", () => {
    expect(buildQuotePdfDownloadFilename("Q-0001")).toBe("Quote-Q-0001.pdf");
  });

  it("strips diacritics", () => {
    expect(buildQuotePdfDownloadFilename("Café-01")).toBe("Quote-Cafe-01.pdf");
  });

  it("collapses non-alphanumeric runs to a single hyphen", () => {
    expect(buildQuotePdfDownloadFilename("Q #0001 / Draft")).toBe("Quote-Q-0001-Draft.pdf");
  });

  it("trims leading/trailing whitespace before sanitizing", () => {
    expect(buildQuotePdfDownloadFilename("  Q-0001  ")).toBe("Quote-Q-0001.pdf");
  });

  it("a fully non-alphanumeric input falls back to the generic filename", () => {
    expect(buildQuotePdfDownloadFilename("###")).toBe("Quote.pdf");
  });

  it("an empty string falls back to the generic filename", () => {
    expect(buildQuotePdfDownloadFilename("")).toBe("Quote.pdf");
  });

  it("truncates a very long quote number to the same bound Invoice's own filename helper uses", () => {
    const long = "X".repeat(300);
    const result = buildQuotePdfDownloadFilename(long);
    expect(result).toBe(`Quote-${"X".repeat(100)}.pdf`);
  });
});
