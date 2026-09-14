import type { ContractStatus } from "@/generated/prisma/browser";

/**
 * Contracts Phase 1 — the single source of truth for every derived
 * Contract status question, mirroring src/lib/quotes/status.ts's own
 * exact discipline: no I/O, no Prisma Client import, no `new Date()`
 * call anywhere in this file by default — `now` is always an optional,
 * explicit, injected parameter (defaulting to a fresh `new Date()` only
 * at the actual comparison site inside each function), matching Quote's
 * own `isQuoteExpired`/Invoice's own `computePaidAtUpdate()` determinism/
 * testability discipline.
 *
 * Only DRAFT/SENT/ACCEPTED/TERMINATED are ever a real, persisted
 * ContractStatus value (see Contract's own schema comment). ACTIVE and
 * EXPIRED are both derived here, never stored — every consumer (a future
 * Server Action, a future UI) must call getContractDisplayStatus() rather
 * than re-deriving either rule inline a second time. archivedAt is a
 * fully separate, orthogonal concept (see isContractArchived below) —
 * archiving/restoring never changes, and is never conflated with, any of
 * the values this file computes.
 *
 * No UI colors/styles/labels of any kind belong in this file — that is a
 * later phase's own concern.
 */

export type ContractDisplayStatus = "DRAFT" | "SENT" | "ACCEPTED" | "ACTIVE" | "EXPIRED" | "TERMINATED";

export type ContractExpiryInput = {
  status: ContractStatus;
  expiresAt: Date | null;
  /** Injected for determinism/testability — defaults to `new Date()` only at the call site, never read from module state. */
  now?: Date;
};

/**
 * EXPIRED is derived, never stored: only an ACCEPTED Contract can be
 * expired (a DRAFT/SENT was never accepted, and TERMINATED is already a
 * resolved terminal outcome that takes precedence over everything —
 * see getContractDisplayStatus below). `expiresAt === null` means "no
 * expiry was ever set" — never treated as expired.
 *
 * Boundary, reused verbatim from isQuoteExpired's own already-approved
 * semantics for full consistency with this app's one existing date-only
 * expiry precedent: strict less-than (`expiresAt.getTime() <
 * reference.getTime()`). Because every date-only value in this app is
 * stored as 00:00:00.000 UTC on its own named calendar day (see
 * src/lib/invoices/date-only.ts), this means a Contract is NOT expired
 * for any instant strictly before its own expiresAt day begins, becomes
 * expired starting the very first instant AFTER that exact UTC midnight
 * (expiresAt.getTime() < reference.getTime()), and is therefore
 * considered expired for the entirety of its own expiresAt calendar day
 * onward — the same "valid only through the day before" boundary
 * isQuoteExpired already established, not a new rule invented here.
 */
export function isContractExpired({ status, expiresAt, now }: ContractExpiryInput): boolean {
  if (status !== "ACCEPTED") return false;
  if (expiresAt === null) return false;
  const reference = now ?? new Date();
  return expiresAt.getTime() < reference.getTime();
}

export type ContractDerivedStateInput = {
  status: ContractStatus;
  effectiveDate: Date | null;
  expiresAt: Date | null;
  now?: Date;
};

/**
 * The one function every future UI/query must call to know what to show
 * a user — never `status` alone. TERMINATED always takes precedence over
 * every derived ACTIVE/EXPIRED reading (a terminated Contract is a
 * resolved, terminal state; nothing about effectiveDate/expiresAt can
 * ever override it). For an ACCEPTED Contract: EXPIRED takes precedence
 * over "not yet effective" (a defensive ordering only — write-time
 * validation already guarantees expiresAt is strictly after
 * effectiveDate/issueDate whenever both are set, so the two conditions
 * should never genuinely overlap in practice). Otherwise: a future
 * effectiveDate (strictly after `now`) keeps the display at ACCEPTED
 * ("accepted, not yet in effect"); a null or already-past-or-current
 * effectiveDate promotes it to ACTIVE.
 */
export function getContractDisplayStatus(input: ContractDerivedStateInput): ContractDisplayStatus {
  const { status, effectiveDate, expiresAt } = input;
  const reference = input.now ?? new Date();

  if (status === "DRAFT") return "DRAFT";
  if (status === "SENT") return "SENT";
  if (status === "TERMINATED") return "TERMINATED";

  // status === "ACCEPTED"
  if (isContractExpired({ status, expiresAt, now: reference })) return "EXPIRED";
  if (effectiveDate !== null && effectiveDate.getTime() > reference.getTime()) return "ACCEPTED";
  return "ACTIVE";
}

/**
 * Whether this Contract's own document content (title/body/client/
 * project/signatory/contractNumber/issueDate/effectiveDate/expiresAt) may
 * still be edited right now. Only DRAFT qualifies — the document becomes
 * immutable the instant it is SENT (see this app's own architecture-lock
 * report §8) and stays immutable through ACCEPTED and TERMINATED alike;
 * there is no "revert to draft" in this phase. `internalNotes` is
 * deliberately NOT covered by this function — it remains Staff-editable
 * in every status (see updateContractInternalNotes() in service.ts,
 * which never calls this function at all, by design).
 */
export function isContractEditable(status: ContractStatus): boolean {
  return status === "DRAFT";
}

/** Archive/restore is fully orthogonal to `status` — never conflate the two. */
export function isContractArchived(archivedAt: Date | null): boolean {
  return archivedAt !== null;
}
