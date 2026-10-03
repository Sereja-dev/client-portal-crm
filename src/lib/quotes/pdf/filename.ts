/**
 * Quote PDF — download filename sanitization. A deliberate per-module
 * copy of src/lib/invoices/pdf/storage.ts's own
 * buildInvoicePdfDownloadFilename() logic (same MAX_STEM_LENGTH/fallback
 * shape, "Quote-" prefix instead of "Invoice-") rather than generalizing
 * that function to accept a prefix — this codebase's own established
 * convention for a small, pure, domain-specific string helper (see e.g.
 * src/lib/invoices/currencies.ts's own per-module Decimal type-alias
 * precedent) over widening an Invoice-owned module's own public contract.
 */

const MAX_STEM_LENGTH = 100;
const FALLBACK_FILENAME = "Quote.pdf";

// Combining diacritical marks (U+0300-U+036F) — constructed via RegExp
// from an explicit \u-escaped string, deliberately never a literal
// character-class source range, so this file's own on-disk bytes stay
// plain ASCII regardless of editor/terminal/encoding.
const COMBINING_MARKS_PATTERN = new RegExp("[\\u0300-\\u036f]", "g");

export function buildQuotePdfDownloadFilename(rawQuoteNumber: string): string {
  const trimmed = rawQuoteNumber.trim();
  const decomposed = trimmed.normalize("NFKD");
  const marksRemoved = decomposed.replace(COMBINING_MARKS_PATTERN, "");
  const collapsed = marksRemoved.replace(/[^A-Za-z0-9]+/g, "-");
  const edgesTrimmed = collapsed.replace(/^-+/, "").replace(/-+$/, "");
  const truncated = edgesTrimmed.slice(0, MAX_STEM_LENGTH);
  const stem = truncated.replace(/-+$/, "");

  return stem.length > 0 ? `Quote-${stem}.pdf` : FALLBACK_FILENAME;
}
