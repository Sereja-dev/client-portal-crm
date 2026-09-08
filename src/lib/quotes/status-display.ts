import { formatStatusLabel } from "@/lib/format";
import { isQuoteConverted, isQuoteExpired } from "@/lib/quotes/status";
import type { QuoteStatusValue } from "@/lib/validation/quote";

export type QuoteStatusDisplayInput = {
  status: QuoteStatusValue;
  validUntil: Date | null;
  convertedInvoiceId: string | null;
};

const DERIVED_LABELS: Record<"CONVERTED" | "EXPIRED", string> = {
  CONVERTED: "Converted",
  EXPIRED: "Expired",
};

/**
 * Quotes / Estimates Phase 3 §N, reused unchanged by Phase 4's Client
 * Portal surfaces (§Q of that phase's own task spec: "Staff and Portal
 * must use one canonical derived Quote status helper... do NOT
 * duplicate"). Kept in src/lib/quotes/ (pure logic, no React, no
 * Prisma) rather than the src/components/quotes/ Staff-presentation
 * module that originally defined it, specifically so a Portal page can
 * import this one function directly without ever importing anything
 * from src/components/quotes/ (the Staff Quote UI) — this codebase's own
 * consistent discipline: Client Portal code never imports a Staff-domain
 * src/components/<domain>/ module (see e.g. the Portal Invoice pages,
 * which build their own display rather than reusing
 * src/components/invoices/InvoiceReadOnlyView). Sibling to
 * target-display.ts, which follows the identical "shared derivation
 * lives in src/lib/quotes/, only the presentational wrapper stays
 * Staff-side" split.
 *
 * The single place that decides what a Quote's own status actually
 * displays as. Every caller — Staff's own QuoteStatusBadge component,
 * and every Portal Quote surface — renders a Quote's status by calling
 * THIS function, never by re-deriving CONVERTED/EXPIRED inline a second
 * time — both remain purely derived (see src/lib/quotes/status.ts's own
 * header comment: neither is ever a real QuoteStatus enum value).
 *
 * Precedence (intentional, not incidental):
 *
 *   1. CONVERTED  — convertedInvoiceId is set
 *   2. EXPIRED    — status === SENT and validUntil has passed
 *   3. stored status (DRAFT / SENT / APPROVED / DECLINED)
 *
 * CONVERTED outranks everything else, including EXPIRED: a Quote's
 * `validUntil` only describes how long the *offer* stood open before it
 * was accepted — once it has actually been converted into a real
 * Invoice, whether that original offer window has since lapsed is no
 * longer the relevant fact about this Quote; showing "Expired" on an
 * already-converted Quote would be actively misleading (it reads as "this
 * opportunity is gone," when the opposite already happened — it was
 * won). EXPIRED, in turn, only ever applies to a still-SENT Quote:
 * APPROVED/DECLINED are already resolved outcomes that a later, unrelated
 * `validUntil` passing can't retroactively unwind (isQuoteExpired() itself
 * enforces this — see its own doc comment), and DRAFT was never sent in
 * the first place. So by the time this function reaches its `else`
 * branch, the stored `status` is always already the correct, undecorated
 * thing to show.
 */
export function deriveQuoteStatusDisplay(quote: QuoteStatusDisplayInput): { key: string; label: string } {
  if (isQuoteConverted({ convertedInvoiceId: quote.convertedInvoiceId })) {
    return { key: "CONVERTED", label: DERIVED_LABELS.CONVERTED };
  }
  if (isQuoteExpired({ status: quote.status, validUntil: quote.validUntil })) {
    return { key: "EXPIRED", label: DERIVED_LABELS.EXPIRED };
  }
  return { key: quote.status, label: formatStatusLabel(quote.status) };
}
