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
 * Excel locale-compatibility directive (Excel Compatibility Fix —
 * production issue: Client export opened directly in Excel under a
 * comma-decimal regional setting, e.g. Russian, shows the whole header
 * row in a single column). Excel's "double-click a .csv and open it"
 * path — as opposed to an explicit Data > From Text/CSV import — infers
 * the column delimiter from the OS/Excel regional "list separator"
 * setting, not from the file's own content. Locales that use comma as
 * the *decimal* separator (Russian, German, French, and most of
 * continental Europe/Latin America) default that list separator to
 * semicolon, so a plain comma-delimited file opens as one column.
 *
 * A leading `sep=,` line is Microsoft's own documented convention for
 * exactly this: when it is the first line of the file, Excel reads it
 * as a directive (never a data row) and uses the given character as the
 * delimiter for the rest of the file, regardless of regional settings —
 * in every locale, not just the broken ones. This is deliberately NOT a
 * delimiter change (the actual field delimiter stays comma, so every
 * non-Excel consumer — Google Sheets, Apple Numbers, a plain CSV
 * parser, our own future CSV Import — still sees standard, unmodified
 * RFC 4180 comma-CSV); it is purely an additional leading line that
 * tells Excel specifically what that delimiter already is.
 *
 * Tradeoff (accepted, see the Excel compatibility diagnostic): a reader
 * that does not recognize this convention (Google Sheets, Numbers, a
 * generic script) sees one extra, harmless, self-evident line
 * (`sep=,`) above the real header — never silent data corruption, never
 * a shifted/misaligned column. Aqenra's own future CSV Import parser
 * must detect and skip an optional leading `sep=X` line before treating
 * the next line as the header (see this module's own header comment for
 * the full contract) — this line is metadata about the file, never a
 * CRM data row.
 *
 * Deliberately a bare literal, never passed through escapeCsvField/
 * csvTextCell/neutralizeFormulaPrefix: it is not a data cell (quoting it
 * as `"sep=,"` would stop Excel from recognizing it as the directive at
 * all), and it is a hardcoded compile-time constant, never derived from
 * user input, so it carries no formula-injection risk of its own.
 */
const EXCEL_SEPARATOR_DIRECTIVE = "sep=,";

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
 * The full document: UTF-8 BOM, then the Excel locale-compatibility
 * directive (see EXCEL_SEPARATOR_DIRECTIVE's own comment — bare, exactly
 * once, its own CRLF-terminated line, never escaped/quoted/passed through
 * csvTextCell), then every row (the header row included — callers pass it
 * as plain literal strings, e.g. ["ID", "Name", ...], which never need
 * escaping since they're compile-time constants with no special
 * characters) joined in order.
 */
export function buildCsvDocument(rows: string[][]): string {
  return UTF8_BOM + EXCEL_SEPARATOR_DIRECTIVE + CRLF + rows.map(buildCsvRow).join("");
}
