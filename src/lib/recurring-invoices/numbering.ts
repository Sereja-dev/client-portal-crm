/**
 * Recurring Invoices Phase 1 — the smallest clear numbering convention
 * (finalized design's own "avoid an overpowered formatting language"
 * decision). A candidate invoice number is always plain string
 * concatenation: `invoiceNumberPrefix + sequence` — no "{seq}"-style
 * token, no zero-padding, no general templating engine of any kind.
 * There is no global invoice-number allocator anywhere else in this app
 * (see RecurringInvoice.invoiceNumberPrefix's own schema comment); this
 * is a per-schedule counter only and never alters ordinary manual
 * invoice-numbering behavior.
 */

export const INVOICE_NUMBER_PREFIX_MAX_LENGTH = 40;

/** Trimmed, non-empty, at most INVOICE_NUMBER_PREFIX_MAX_LENGTH characters, no leading/trailing whitespace once trimmed matches the input exactly (never silently re-trimmed by a caller that forgot to). */
export function isValidInvoiceNumberPrefix(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= INVOICE_NUMBER_PREFIX_MAX_LENGTH;
}

/** Composes one candidate invoice number — the sole place this concatenation happens, so the "no token language" contract stays enforced in exactly one function. */
export function composeInvoiceNumberCandidate(prefix: string, sequence: number): string {
  return `${prefix}${sequence}`;
}

export const STARTING_SEQUENCE_MIN = 1;
// A generous, deliberately bounded ceiling (not a real business limit) —
// keeps a malformed/typo'd starting value from silently creating an
// absurd candidate number, same "sensible max" discipline as every other
// bounded integer in this app's own validation layer.
export const STARTING_SEQUENCE_MAX = 1_000_000_000;

export function isValidSequence(value: number): boolean {
  return Number.isInteger(value) && value >= STARTING_SEQUENCE_MIN && value <= STARTING_SEQUENCE_MAX;
}
