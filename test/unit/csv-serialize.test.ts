import { describe, expect, it } from "vitest";
import {
  escapeCsvField,
  neutralizeFormulaPrefix,
  csvTextCell,
  csvNumberCell,
  buildCsvRow,
  buildCsvDocument,
} from "@/lib/csv/serialize";

/**
 * CSV Import/Export Phase 1 — the shared CSV serialization module. Every
 * export Route Handler builds its document through these functions, so
 * this is the one place RFC 4180 escaping, formula-injection
 * neutralization, and the numeric/text-cell distinction are proven
 * directly, rather than re-derived per route.
 */
describe("escapeCsvField", () => {
  it("returns a plain value unquoted", () => {
    expect(escapeCsvField("Acme Corp")).toBe("Acme Corp");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvField("Acme, Inc.")).toBe('"Acme, Inc."');
  });

  it("quotes and doubles an embedded double quote", () => {
    expect(escapeCsvField('Say "hello"')).toBe('"Say ""hello"""');
  });

  it("quotes a value containing an embedded newline", () => {
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a value containing an embedded carriage return", () => {
    expect(escapeCsvField("line one\rline two")).toBe('"line one\rline two"');
  });

  it("preserves Unicode content unchanged (aside from quoting rules)", () => {
    expect(escapeCsvField("Müller Café — 日本語")).toBe("Müller Café — 日本語");
  });
});

describe("neutralizeFormulaPrefix — CSV formula injection protection", () => {
  it.each(["=1+1", "=cmd|'/c calc'!A1", "+1+1", "-1+1", "@SUM(A1:A2)"])(
    "prefixes a dangerous formula-triggering value (%s) with a single quote",
    (dangerous) => {
      expect(neutralizeFormulaPrefix(dangerous)).toBe(`'${dangerous}`);
    },
  );

  it("does not alter an ordinary value with no dangerous prefix", () => {
    expect(neutralizeFormulaPrefix("Acme Corp")).toBe("Acme Corp");
    expect(neutralizeFormulaPrefix("hello@example.com")).toBe("hello@example.com");
    expect(neutralizeFormulaPrefix("a-b-c")).toBe("a-b-c");
  });

  it("only checks the leading character — a dangerous character elsewhere in the string is untouched", () => {
    expect(neutralizeFormulaPrefix("Total = 5")).toBe("Total = 5");
  });

  it("does not alter an empty string", () => {
    expect(neutralizeFormulaPrefix("")).toBe("");
  });
});

describe("csvTextCell", () => {
  it("null and undefined both become an empty cell", () => {
    expect(csvTextCell(null)).toBe("");
    expect(csvTextCell(undefined)).toBe("");
  });

  it("an ordinary string passes through unescaped", () => {
    expect(csvTextCell("Jane Doe")).toBe("Jane Doe");
  });

  it("composes formula-neutralization and RFC 4180 escaping in the correct order", () => {
    // "=1+1,2" both triggers formula neutralization (leading '=') AND
    // needs comma-quoting — the quote must wrap the ALREADY-prefixed
    // value, not run before neutralization (which would leave the
    // formula trigger exposed once unquoted by a spreadsheet app).
    expect(csvTextCell("=1+1,2")).toBe('"\'=1+1,2"');
  });

  it("never corrupts an ordinary value that merely contains a dash in the middle", () => {
    expect(csvTextCell("Mary-Jane")).toBe("Mary-Jane");
  });
});

describe("csvNumberCell — deliberately never formula-neutralized or quote-escaped", () => {
  it("a positive number serializes as a plain digit string", () => {
    expect(csvNumberCell(1234.5)).toBe("1234.5");
  });

  it("a legitimate negative number is preserved exactly, never treated as a formula-injection risk", () => {
    expect(csvNumberCell(-500)).toBe("-500");
  });

  it("zero serializes as \"0\", not an empty cell", () => {
    expect(csvNumberCell(0)).toBe("0");
  });

  it("null and undefined both become an empty cell", () => {
    expect(csvNumberCell(null)).toBe("");
    expect(csvNumberCell(undefined)).toBe("");
  });
});

describe("buildCsvRow", () => {
  it("joins cells with commas and terminates with CRLF", () => {
    expect(buildCsvRow(["a", "b", "c"])).toBe("a,b,c\r\n");
  });
});

describe("buildCsvDocument", () => {
  it("prefixes the document with a UTF-8 BOM", () => {
    const doc = buildCsvDocument([["ID", "Name"]]);
    expect(doc.charCodeAt(0)).toBe(0xfeff);
  });

  it("joins every row with CRLF line endings, header included", () => {
    const doc = buildCsvDocument([
      ["ID", "Name"],
      [csvTextCell("1"), csvTextCell("Acme")],
    ]);
    expect(doc).toBe("\uFEFFID,Name\r\n1,Acme\r\n");
  });

  it("round-trips a realistic mixed row (comma, quote, Unicode, formula-triggering value) without corrupting any other cell", () => {
    const doc = buildCsvDocument([
      ["ID", "Name", "Notes"],
      [csvTextCell("1"), csvTextCell("Acme, Inc."), csvTextCell('=HYPERLINK("http://evil.example")')],
    ]);
    const lines = doc.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("ID,Name,Notes");
    expect(lines[1]).toBe('1,"Acme, Inc.","\'=HYPERLINK(""http://evil.example"")"');
  });
});
