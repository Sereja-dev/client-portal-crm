/**
 * CSV Import/Export Phase 1 — the one shared CSV serialization module.
 * Every export Route Handler builds its document through these
 * functions; none hand-rolls its own escaping or formula-injection
 * handling. RFC 4180-compatible: CRLF row terminators, double-quote
 * field quoting (with internal quotes doubled) whenever a field contains
 * a comma, a double quote, or a CR/LF, and a leading UTF-8 BOM so Excel
 * opens the file with the correct character encoding instead of
 * misreading non-ASCII names/company text as Latin-1.
 */

const CRLF = "\r\n";
// U+FEFF, written as an explicit escape (not a literal character in this
// source file) so it can never be silently stripped/mangled by an
// editor, formatter, or a future re-save under a different encoding.
const UTF8_BOM = "\uFEFF";

/**
 * CSV formula injection (OWASP CSV Injection) — mandatory protection for
 * every user-controlled free-text column. A spreadsheet application
 * (Excel, Google Sheets) evaluates a cell as a formula when its content
 * begins with =, +, -, or @, even when the file was opened from a CSV a
 * server generated, not typed by hand. Prefixing such a value with a
 * single quote is the standard, OWASP-documented mitigation: it makes
 * the spreadsheet application treat the cell as literal text, exactly as
 * it already does for a value a person types starting with the same
 * character in a live sheet.
 *
 * Deliberately narrow: this must never be applied to a genuinely numeric
 * column (e.g. Lead.value) — a legitimate negative number's leading "-"
 * is not an injection risk, and prefixing it with a quote would corrupt
 * real numeric export semantics by forcing the column to import back as
 * text. Use csvNumberCell (never csvTextCell) for those columns instead.
 */
const FORMULA_TRIGGER_PATTERN = /^[=+\-@]/;

export function neutralizeFormulaPrefix(value: string): string {
  return FORMULA_TRIGGER_PATTERN.test(value) ? `'${value}` : value;
}

/**
 * RFC 4180 field quoting. Wraps the value in double quotes (doubling any
 * internal double quote) whenever it contains a comma, a double quote,
 * or a CR/LF — otherwise returns it unquoted. Never itself responsible
 * for formula-injection safety (see neutralizeFormulaPrefix) — the two
 * concerns are independent and composed by csvTextCell below.
 */
export function escapeCsvField(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One free-text/user-controlled cell. null/undefined become an empty
 * cell (never the literal string "null"/"undefined") — matches this
 * app's own existing "—"-for-missing-value UI convention's underlying
 * data (an empty CSV cell, not a placeholder string, is the correct
 * machine-readable representation). Every real value is stringified,
 * formula-neutralized, then RFC 4180-escaped, in that order — escaping
 * first would let a formula-triggering character survive inside an
 * already-quoted field.
 */
export function csvTextCell(value: string | null | undefined): string {
  const str = value ?? "";
  return escapeCsvField(neutralizeFormulaPrefix(str));
}

/**
 * One genuinely numeric cell (e.g. Lead.value) — deliberately never
 * formula-neutralized or quote-escaped. A real number can never contain
 * a comma, quote, or newline, and a legitimate negative value's leading
 * "-" must round-trip as a real number, not become injection-guarded
 * text. null/undefined become an empty cell, same as csvTextCell.
 */
export function csvNumberCell(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Joins a row's already-prepared cells (via csvTextCell/csvNumberCell, or a literal header string) with commas and a CRLF terminator. */
export function buildCsvRow(cells: string[]): string {
  return cells.join(",") + CRLF;
}

/**
 * The full document: every row (the header row included — callers pass
 * it as plain literal strings, e.g. ["ID", "Name", ...], which never
 * need escaping since they're compile-time constants with no special
 * characters) joined in order, prefixed with a UTF-8 BOM.
 */
export function buildCsvDocument(rows: string[][]): string {
  return UTF8_BOM + rows.map(buildCsvRow).join("");
}
