/**
 * Quotes / Estimates Phase 1 — a USER-FACING SUGGESTION only, never an
 * authoritative source of uniqueness. Mirrors Invoice's own numbering
 * model (src/lib/invoices/duplicate.ts's `suggestDuplicateInvoiceNumber`):
 * a plain, fully-editable text field (`Quote.number`), with
 * `@@unique([organizationId, number])` plus catching the resulting
 * `P2002` in a future create action as the real race-safety mechanism —
 * never a database sequence/counter table (this phase deliberately does
 * not build one). Two concurrent callers computing the *same* suggestion
 * is expected and harmless; whichever one actually creates a Quote first
 * simply wins, and the second create attempt (if it never lets the user
 * edit the number, which a real form always does) would fail the unique
 * constraint exactly like a duplicate Invoice number already does today.
 *
 * Pure — no I/O, no Prisma import, no `server-only` — fully unit-
 * testable and safe to import from anywhere, including a Client
 * Component. The real, DB-touching half that a future create-Quote
 * page/action actually calls is suggest-next-quote-number.ts, kept in
 * its own file specifically so importing that Prisma-backed, server-only
 * module never becomes a prerequisite for using this pure function alone
 * (confirmed necessary: a single file mixing both tripped `server-only`'s
 * own client-component guard even for code paths that only ever touched
 * this pure half).
 */

const QUOTE_NUMBER_PREFIX = "Q-";
const QUOTE_NUMBER_PAD_WIDTH = 4;
const QUOTE_NUMBER_PATTERN = /^Q-(\d+)$/;

/**
 * Takes whatever `Quote.number` values already exist for the caller's own
 * organization (already fetched by the caller) and suggests the next
 * conventional "Q-0001"-style number. Any existing value that doesn't
 * match the exact `Q-<digits>` shape (a manually-entered reference
 * number, an imported legacy number, anything else) is silently ignored
 * — it neither breaks this suggestion nor influences it, exactly like
 * `suggestDuplicateInvoiceNumber` never inspects an existing Invoice
 * number's own shape beyond appending its literal suffix.
 */
export function computeNextQuoteNumberSuggestion(existingNumbers: readonly string[]): string {
  let highest = 0;
  for (const raw of existingNumbers) {
    const match = QUOTE_NUMBER_PATTERN.exec(raw.trim());
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > highest) {
      highest = parsed;
    }
  }
  const next = highest + 1;
  return `${QUOTE_NUMBER_PREFIX}${String(next).padStart(QUOTE_NUMBER_PAD_WIDTH, "0")}`;
}

export { QUOTE_NUMBER_PREFIX };
