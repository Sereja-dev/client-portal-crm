import { Prisma } from "@/generated/prisma/client";

/**
 * Reports Phase 1 hardening — exact-to-the-cent monetary accumulation.
 * Deliberately NOT `"server-only"`: this is a pure calculation module
 * (like this directory's own revenue-trend.ts), imported from
 * test/unit/*.test.ts with no Prisma test DB and no "server-only" mock
 * available there — matching dashboard/revenue.ts's own identical reason
 * for staying server-agnostic.
 *
 * Every Invoice/Lead money column this module's callers touch is
 * `Decimal(10,2)` (see src/lib/invoices/currencies.ts's own MONEY_MAX
 * precedent) — always exactly 2 fractional digits. Converting through
 * `Prisma.Decimal` arithmetic (never `Number()` first) and multiplying by
 * 100 therefore always lands on an exact integer number of cents; summing
 * those integers with plain `+` is exact (IEEE-754 double addition of two
 * integers is exact whenever both addends and their sum stay within the
 * safe integer range — see this module's own boundary test). Only the
 * FINAL cents-to-decimal conversion, at the one Reports view-model
 * boundary, ever divides by 100.
 */

/**
 * `amount` is a Prisma.Decimal in production; a plain number or numeric
 * string is also accepted (test fixtures). `Prisma.Decimal.isDecimal()`,
 * not `instanceof` — matches this app's own established cross-module-
 * Decimal-identity caveat (see src/lib/invoices/currencies.ts's own
 * doc comment on why `instanceof` alone is not safe here).
 */
function toDecimal(amount: unknown): Prisma.Decimal {
  return Prisma.Decimal.isDecimal(amount) ? amount : new Prisma.Decimal(String(amount));
}

/**
 * Converts one money amount to an exact integer number of cents — never
 * a JS float multiplication. `toDecimalPlaces(0)` is defensive rounding
 * only (a well-formed Decimal(10,2) value times 100 is already an exact
 * integer); it never masks a real precision loss for this schema's own
 * money columns.
 */
export function toExactCents(amount: unknown): number {
  return toDecimal(amount).times(100).toDecimalPlaces(0).toNumber();
}

/**
 * Sums already-converted integer cents — exact, not an approximation.
 * This schema's own Decimal(10,2) ceiling is 99,999,999.99 (see
 * src/lib/invoices/currencies.ts's own MONEY_MAX), i.e. at most
 * 9,999,999,999 cents per row (~1e10); summing many thousands of such
 * rows stays many orders of magnitude below `Number.MAX_SAFE_INTEGER`
 * (2^53 - 1 ≈ 9.007e15) — see this module's own boundary test for the
 * exact margin.
 */
export function sumExactCents(centsValues: readonly number[]): number {
  return centsValues.reduce((sum, cents) => sum + cents, 0);
}

/**
 * The one place Reports converts an exact integer-cents accumulation
 * back into the serializable decimal-number the view model exposes —
 * called exactly once per reported figure, at the very end of its own
 * accumulation, never mid-calculation.
 */
export function centsToAmount(cents: number): number {
  return cents / 100;
}
