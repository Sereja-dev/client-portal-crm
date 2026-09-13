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

  it("joins every row with CRLF line endings, header included, after the BOM + sep=, directive line", () => {
    const doc = buildCsvDocument([
      ["ID", "Name"],
      [csvTextCell("1"), csvTextCell("Acme")],
    ]);
    expect(doc).toBe("\uFEFFsep=,\r\nID,Name\r\n1,Acme\r\n");
  });

  it("round-trips a realistic mixed row (comma, quote, Unicode, formula-triggering value) without corrupting any other cell", () => {
    const doc = buildCsvDocument([
      ["ID", "Name", "Notes"],
      [csvTextCell("1"), csvTextCell("Acme, Inc."), csvTextCell('=HYPERLINK("http://evil.example")')],
    ]);
    const lines = doc.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("sep=,");
    expect(lines[1]).toBe("ID,Name,Notes");
    expect(lines[2]).toBe('1,"Acme, Inc.","\'=HYPERLINK(""http://evil.example"")"');
  });
});

describe("buildCsvDocument — Excel locale-compatibility directive (sep=,)", () => {
  // Production issue: Client export opened directly in Excel under a
  // comma-decimal regional setting (e.g. Russian) rendered the whole
  // header row in a single column, because Excel infers the delimiter
  // from the OS/Excel regional "list separator" setting when a .csv is
  // opened directly, not from the file's own content. A leading `sep=,`
  // line is Microsoft's own documented convention that overrides this
  // guess in every locale. These tests pin the exact byte-level contract
  // so this can never silently regress (wrong order, missing directive,
  // duplicated directive, or an accidentally-escaped/quoted directive
  // would all defeat Excel's ability to recognize it).

  it("emits BOM, then the bare sep=, directive, then CRLF, as the first bytes of every document — verified at the byte level", () => {
    const doc = buildCsvDocument([["ID", "Name"]]);
    const bytes = Buffer.from(doc, "utf8");
    // EF BB BF (UTF-8 BOM) + ASCII "sep=," + CR LF
    const expectedPrefix = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("sep=,\r\n", "ascii"),
    ]);
    expect(bytes.subarray(0, expectedPrefix.length)).toEqual(expectedPrefix);
  });

  it("the directive is bare/unquoted — never the escaped form \"sep=,\"", () => {
    const doc = buildCsvDocument([["ID", "Name"]]);
    expect(doc).not.toContain('"sep=,"');
    const firstLine = doc.replace(/^\uFEFF/, "").split("\r\n")[0];
    expect(firstLine).toBe("sep=,");
  });

  it("appears exactly once per document, before the header, never repeated per row", () => {
    const doc = buildCsvDocument([
      ["ID", "Name"],
      [csvTextCell("1"), csvTextCell("Acme")],
      [csvTextCell("2"), csvTextCell("Widgets Co")],
      [csvTextCell("3"), csvTextCell("Another Row")],
    ]);
    const occurrences = doc.split("sep=,").length - 1;
    expect(occurrences).toBe(1);

    const lines = doc.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("sep=,");
    expect(lines[1]).toBe("ID,Name"); // the real header, immediately after the directive
  });

  it("is never neutralized as a formula trigger or escaped as a CSV field, even though it structurally contains a comma", () => {
    // A real data cell containing a comma would be quoted by
    // escapeCsvField; the directive line must never go through that (or
    // neutralizeFormulaPrefix) — it is a hardcoded literal, not a value
    // sourced from csvTextCell/csvNumberCell.
    const doc = buildCsvDocument([["ID", "Name"]]);
    const firstLine = doc.replace(/^\uFEFF/, "").split("\r\n")[0];
    expect(firstLine).toBe("sep=,");
    expect(firstLine.startsWith('"')).toBe(false);
    expect(firstLine.startsWith("'")).toBe(false); // not formula-neutralized either
  });

  it("does not disturb ordinary field delimiting — the actual CSV field delimiter is still a plain comma", () => {
    const doc = buildCsvDocument([
      ["ID", "Name", "Company"],
      [csvTextCell("1"), csvTextCell("Jane Doe"), csvTextCell("Acme")],
    ]);
    const lines = doc.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines[1]).toBe("ID,Name,Company");
    expect(lines[2]).toBe("1,Jane Doe,Acme");
  });
});
