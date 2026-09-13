import { describe, expect, it } from "vitest";
import { parseImportCsv, stripLeadingSepDirective, detectRowLengthMismatch } from "@/lib/import/csv-parse";
import { MAX_IMPORT_ROWS } from "@/lib/import/constants";

/**
 * CSV Import Phase 2 — the shared CSV parser wrapper. Covers every
 * format/compatibility case the approved architecture calls out
 * explicitly: plain comma CSV, UTF-8 BOM, BOM + sep=, (our own export's
 * exact output shape — round-trip), quoted commas, embedded quotes,
 * embedded newlines, Unicode, blank lines, malformed rows, empty file,
 * header-only, oversized/row-limit overflow.
 */
describe("stripLeadingSepDirective", () => {
  it("strips a bare sep=, directive line, leaving the BOM already-consumed", () => {
    const result = stripLeadingSepDirective("sep=,\r\nID,Name\r\n1,Acme\r\n");
    expect(result).toBe("ID,Name\r\n1,Acme\r\n");
  });

  it("strips a sep=, directive that follows a UTF-8 BOM", () => {
    const result = stripLeadingSepDirective("﻿sep=,\r\nID,Name\r\n1,Acme\r\n");
    expect(result).toBe("ID,Name\r\n1,Acme\r\n");
  });

  it("strips a sep=; directive (a different delimiter character) just as readily", () => {
    const result = stripLeadingSepDirective("sep=;\r\nID;Name\r\n1;Acme\r\n");
    expect(result).toBe("ID;Name\r\n1;Acme\r\n");
  });

  it("leaves content with no directive completely untouched, BOM included", () => {
    const input = "﻿ID,Name\r\n1,Acme\r\n";
    expect(stripLeadingSepDirective(input)).toBe(input);
  });

  it("never strips a sep= appearing on a later line (only the very first line counts)", () => {
    const input = "ID,Name\r\nsep=,,Acme\r\n";
    expect(stripLeadingSepDirective(input)).toBe(input);
  });
});

describe("parseImportCsv — format compatibility", () => {
  it("parses plain comma CSV", () => {
    const result = parseImportCsv("ID,Name\r\n1,Acme\r\n2,Widgets\r\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.headers).toEqual(["ID", "Name"]);
    expect(result.result.rows).toEqual([
      ["1", "Acme"],
      ["2", "Widgets"],
    ]);
  });

  it("parses CSV with a UTF-8 BOM", () => {
    const result = parseImportCsv("﻿ID,Name\r\n1,Acme\r\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.headers).toEqual(["ID", "Name"]);
  });

  it("parses BOM + sep=, (this app's own Client/Lead CSV export output shape) round-trip correctly", () => {
    const exported = "﻿sep=,\r\nID,Name\r\n1,Acme\r\n2,\"Widgets, Inc.\"\r\n";
    const result = parseImportCsv(exported);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.headers).toEqual(["ID", "Name"]);
    expect(result.result.rows).toEqual([
      ["1", "Acme"],
      ["2", "Widgets, Inc."],
    ]);
  });

  it("parses quoted commas inside a field", () => {
    const result = parseImportCsv('Name,Company\r\n"Doe, Jane","Acme, Inc."\r\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.rows[0]).toEqual(["Doe, Jane", "Acme, Inc."]);
  });

  it("parses embedded escaped double quotes", () => {
    const result = parseImportCsv('Name,Notes\r\n"Jane","She said ""hello"""\r\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.rows[0]).toEqual(["Jane", 'She said "hello"']);
  });

  it("parses an embedded newline inside a quoted field", () => {
    const result = parseImportCsv('Name,Notes\r\n"Jane","line one\nline two"\r\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.rows[0]).toEqual(["Jane", "line one\nline two"]);
  });

  it("parses Unicode content correctly", () => {
    const result = parseImportCsv("Name,Company\r\nMüller,日本語株式会社\r\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.rows[0]).toEqual(["Müller", "日本語株式会社"]);
  });

  it("skips blank lines", () => {
    const result = parseImportCsv("Name,Company\r\n1,Acme\r\n\r\n2,Widgets\r\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.rows).toHaveLength(2);
  });

  it("still returns a malformed row (wrong column count) rather than aborting the whole parse", () => {
    const result = parseImportCsv("ID,Name,Email\r\n1,Acme\r\n2,Widgets,w@x.com\r\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.rows[0]).toEqual(["1", "Acme"]);
    expect(detectRowLengthMismatch(result.result.rows[0], result.result.headers.length)).toBe(true);
    expect(detectRowLengthMismatch(result.result.rows[1], result.result.headers.length)).toBe(false);
  });

  it("rejects a genuinely empty file", () => {
    const result = parseImportCsv("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("empty_file");
  });

  it("rejects a header-only file (no data rows)", () => {
    const result = parseImportCsv("ID,Name\r\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("header_only");
  });

  it("rejects a file exceeding the row-limit ceiling", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `${i},Name-${i}`).join("\r\n");
    const result = parseImportCsv(`ID,Name\r\n${rows}\r\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("row_limit_exceeded");
  });

  it("accepts a file at exactly the row-limit ceiling", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `${i},Name-${i}`).join("\r\n");
    const result = parseImportCsv(`ID,Name\r\n${rows}\r\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.rows).toHaveLength(MAX_IMPORT_ROWS);
  });
});
