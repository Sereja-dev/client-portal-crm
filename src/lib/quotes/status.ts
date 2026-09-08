import type { QuoteStatus } from "@/generated/prisma/browser";

/**
 * Quotes / Estimates Phase 1 — the single source of truth for every
 * derived Quote status question (docs: the approved Quotes architecture
 * audit + this phase's own correction task). No I/O, no Prisma Client
 * import, no `new Date()` call anywhere in this file by default — `now`
 * is always an optional, explicit, injected parameter (defaulting to a
 * fresh `new Date()` only at the actual call site inside each function),
 * matching the same determinism/testability discipline
 * src/lib/invoices/lifecycle.ts's own `computePaidAtUpdate()` already
 * established.
 *
 * Only DRAFT/SENT/APPROVED/DECLINED are ever a real, persisted
 * QuoteStatus value (see Quote's own schema comment). EXPIRED and
 * CONVERTED are both derived here, never stored — every consumer
 * (a future Server Action, a future UI) must call these functions rather
 * than re-deriving either rule inline a second time, the same
 * "centralize it in one module" discipline src/lib/leads/stages.ts
 * already established for Lead's own stage semantics.
 *
 * No UI colors/styles/labels of any kind belong in this file — that is a
 * later phase's own concern (see src/components/leads/lead-stage-badge.tsx
 * for the equivalent Lead-side separation).
 */

export type QuoteExpiryInput = {
  status: QuoteStatus;
  validUntil: Date | null;
  /** Injected for determinism/testability — defaults to `new Date()` only at the call site, never read from module state. */
  now?: Date;
};

/**
 * EXPIRED is derived, never stored: only a SENT Quote can be expired (a
 * DRAFT was never sent, and APPROVED/DECLINED are already resolved
 * outcomes — a Quote approved before its own deadline stays approved
 * even if `validUntil` has since passed; re-opening an APPROVED/DECLINED
 * Quote for a fresh round is what the DRAFT-first re-send rule is for,
 * not this check). `validUntil === null` means "no expiry was ever set"
 * — never treated as expired.
 */
export function isQuoteExpired({ status, validUntil, now }: QuoteExpiryInput): boolean {
  if (status !== "SENT") return false;
  if (validUntil === null) return false;
  const reference = now ?? new Date();
  return validUntil.getTime() < reference.getTime();
}

export type QuoteConvertedInput = {
  convertedInvoiceId: string | null | undefined;
};

/** CONVERTED is derived, never stored: a Quote is converted exactly when it has a linked Invoice. */
export function isQuoteConverted({ convertedInvoiceId }: QuoteConvertedInput): boolean {
  return convertedInvoiceId !== null && convertedInvoiceId !== undefined;
}

/**
 * Whether this Quote's own financial content (line items, totals,
 * discount/tax, recipient) may still be edited right now. APPROVED is
 * immutable — once a client has accepted a Quote, nothing may silently
 * change what they saw (see this module's own header comment and Quote's
 * own `approvedAt` field comment). A converted Quote (a real Invoice
 * already exists from it) is likewise never editable, regardless of its
 * own stored status — it is now a historical record of exactly what was
 * converted. `convertedInvoiceId` is optional here precisely so a caller
 * that hasn't loaded it (or knows it can't apply, e.g. a brand-new
 * in-memory draft) can still ask this question from `status` alone.
 */
export function isQuoteEditable(status: QuoteStatus, convertedInvoiceId?: string | null): boolean {
  if (isQuoteConverted({ convertedInvoiceId })) return false;
  return status !== "APPROVED";
}

/**
 * Whether this Quote may currently be approved (or declined — the two
 * share the same precondition: a live, still-open offer). Only a SENT
 * Quote qualifies, and only if it hasn't already expired — an expired
 * Quote must be reactivated (moved back to DRAFT and re-sent) before it
 * can be approved again, never approved directly past its own deadline.
 */
export function isQuoteApprovable({ status, validUntil, now }: QuoteExpiryInput): boolean {
  if (status !== "SENT") return false;
  return !isQuoteExpired({ status, validUntil, now });
}
