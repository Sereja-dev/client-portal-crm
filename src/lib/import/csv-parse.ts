import { parse as parseCsvSync } from "csv-parse/sync";
import { MAX_IMPORT_ROWS } from "./constants";

/**
 * CSV Import Phase 2 — the one shared "raw uploaded text -> headers +
 * data rows" parser every import Server Action goes through (upload,
 * preview, and execute all call this same function against the same
 * ImportJob.rawContent — never a second, slightly different parse path).
 *
 * Uses `csv-parse` (a mature, widely-used, actively-maintained Node CSV
 * parser — not hand-rolled) for quoted commas, escaped quotes, and
 * embedded CR/LF inside quoted fields, all verified directly against
 * this exact configuration before use. `bom: true` strips a leading
 * UTF-8 BOM automatically; `relax_column_count: true` means a single
 * ragged row (too few/many columns) never aborts the whole parse — see
 * detectRowLengthMismatch below, used by the row-validation layer to
 * still surface that specific row as a validation error, not silently
 * accept or silently drop it.
 */

export type ParsedCsvFile = { headers: string[]; rows: string[][] };

export type CsvParseFailure =
  | { code: "empty_file"; message: string }
  | { code: "header_only"; message: string }
  | { code: "row_limit_exceeded"; message: string; rowCount: number }
  | { code: "malformed"; message: string };

const SEP_DIRECTIVE_PATTERN = /^sep=.\r?\n/;

/**
 * Excel Compatibility Fix's own counterpart on the read side: our own
 * exports (and any other Excel-targeting CSV) may carry an optional
 * leading `sep=X` directive line, immediately after the BOM — Microsoft's
 * own documented convention (see src/lib/csv/serialize.ts's own doc
 * comment on the write side). This is file metadata, never CRM data: it
 * must be detected and skipped BEFORE the real header row is
 * interpreted, and before the text is handed to csv-parse at all --
 * csv-parse has no notion of this convention and would otherwise split
 * "sep=," into two literal columns (["sep=", ""]) as if it were a real
 * data row.
 *
 * Only ever strips a directive that is genuinely the first line (after
 * a BOM, if present) — a `sep=` appearing anywhere else in the file
 * (e.g. as a legitimate cell value on a later row) is left completely
 * untouched, since this pattern only ever matches at the very start of
 * the string.
 */
export function stripLeadingSepDirective(rawText: string): string {
  const withoutBom = rawText.replace(/^﻿/, "");
  const match = withoutBom.match(SEP_DIRECTIVE_PATTERN);
  if (!match) {
    return rawText; // no directive present — return completely untouched, BOM included, for csv-parse's own bom:true to strip.
  }
  return withoutBom.slice(match[0].length);
}

export function parseImportCsv(rawText: string): { ok: true; result: ParsedCsvFile } | { ok: false; error: CsvParseFailure } {
  const withoutDirective = stripLeadingSepDirective(rawText);

  let table: string[][];
  try {
    table = parseCsvSync(withoutDirective, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: false,
    }) as string[][];
  } catch {
    return {
      ok: false,
      error: { code: "malformed", message: "This file could not be read as CSV. Check that it's a valid, well-formed CSV export." },
    };
  }

  if (table.length === 0) {
    return { ok: false, error: { code: "empty_file", message: "This file is empty." } };
  }

  const [headers, ...rows] = table;
  if (rows.length === 0) {
    return { ok: false, error: { code: "header_only", message: "This file only has a header row — there are no records to import." } };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: {
        code: "row_limit_exceeded",
        message: `This file has ${rows.length} rows, which is more than the ${MAX_IMPORT_ROWS}-row limit per import. Split it into smaller files.`,
        rowCount: rows.length,
      },
    };
  }

  return { ok: true, result: { headers, rows } };
}

/** A row whose actual column count doesn't match the header's — relax_column_count above lets csv-parse still return it (a short row comes back as a shorter array, not padded; a long row keeps every extra cell), but it must still be reported as a distinct, specific row-level validation error rather than silently accepted with misaligned columns. */
export function detectRowLengthMismatch(row: string[], headerCount: number): boolean {
  return row.length !== headerCount;
}
