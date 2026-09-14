import { describe, expect, it } from "vitest";
import { toExactCents, sumExactCents, centsToAmount } from "@/lib/reports/calculations/money";
import { decimal } from "../support/fixtures";

/**
 * Reports Phase 1 hardening — proves exact-to-the-cent accumulation,
 * never repeated JS float addition. Every assertion here is an exact
 * `toBe`, never `toBeCloseTo` — the whole point of this module is that
 * "close" is not good enough for money.
 */

describe("toExactCents", () => {
  it("converts a Prisma.Decimal(10,2) value to an exact integer number of cents", () => {
    expect(toExactCents(decimal("10.50"))).toBe(1050);
    expect(toExactCents(decimal("0.01"))).toBe(1);
    expect(toExactCents(decimal("99999999.99"))).toBe(9999999999);
  });

  it("accepts a plain number or numeric string the same way", () => {
    expect(toExactCents(10.5)).toBe(1050);
    expect(toExactCents("10.50")).toBe(1050);
  });

  it("handles zero", () => {
    expect(toExactCents(decimal("0.00"))).toBe(0);
    expect(toExactCents(0)).toBe(0);
  });
});

describe("sumExactCents / centsToAmount — the classic floating-point failure cases", () => {
  it("0.10 + 0.20 is exactly 0.3, not 0.30000000000000004", () => {
    // Proof this is a real fix, not a tautology: plain JS float addition
    // of these two exact values is famously NOT 0.3.
    expect(0.1 + 0.2).not.toBe(0.3);

    const cents = [decimal("0.10"), decimal("0.20")].map(toExactCents);
    expect(centsToAmount(sumExactCents(cents))).toBe(0.3);
  });

  it("summing 0.01 one hundred times is exactly 1, not 1.0000000000000007", () => {
    let driftingTotal = 0;
    for (let i = 0; i < 100; i++) driftingTotal += 0.01;
    expect(driftingTotal).not.toBe(1); // proof repeated float addition really does drift here

    const cents = Array.from({ length: 100 }, () => toExactCents(decimal("0.01")));
    expect(centsToAmount(sumExactCents(cents))).toBe(1);
  });

  it("mixed values 10.01 + 20.02 + 30.03 sum to exactly 60.06", () => {
    const cents = [decimal("10.01"), decimal("20.02"), decimal("30.03")].map(toExactCents);
    expect(centsToAmount(sumExactCents(cents))).toBe(60.06);
  });

  it("sums an empty row set to exactly 0", () => {
    expect(centsToAmount(sumExactCents([]))).toBe(0);
  });

  it("stays well within Number.MAX_SAFE_INTEGER even summing many rows at the schema's own Decimal(10,2) ceiling", () => {
    // 99,999,999.99 -> 9,999,999,999 cents per row (this schema's own
    // MONEY_MAX, src/lib/invoices/currencies.ts). Even 100,000 such rows
    // (a wildly unrealistic single-organization, single-period PAID
    // invoice count) stays far under Number.MAX_SAFE_INTEGER.
    const oneRowCents = toExactCents(decimal("99999999.99"));
    const total = sumExactCents(Array(100_000).fill(oneRowCents));
    expect(total).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(total)).toBe(true);
  });
});
