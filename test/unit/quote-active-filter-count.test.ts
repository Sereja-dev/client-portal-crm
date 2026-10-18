import { describe, expect, it } from "vitest";
import { computeQuoteActiveFilterCount } from "@/app/(dashboard)/quotes/query";

/**
 * Mobile Improvement Slice B2 — the exact, Product-approved active-count
 * rule for Quotes' own mobile Filter disclosure: status/targetType/
 * archived, each worth at most 1. q and sort are excluded entirely (not
 * even representable — see the function's own `Pick<...>` signature).
 */
describe("computeQuoteActiveFilterCount", () => {
  it("is 0 when no filter field is set", () => {
    expect(
      computeQuoteActiveFilterCount({ status: undefined, targetType: undefined, archived: false }),
    ).toBe(0);
  });

  it("counts status alone as 1 (including a derived value like EXPIRED)", () => {
    expect(
      computeQuoteActiveFilterCount({ status: "EXPIRED", targetType: undefined, archived: false }),
    ).toBe(1);
  });

  it("counts targetType alone as 1", () => {
    expect(
      computeQuoteActiveFilterCount({ status: undefined, targetType: "LEAD", archived: false }),
    ).toBe(1);
  });

  it("counts archived=true alone as 1", () => {
    expect(
      computeQuoteActiveFilterCount({ status: undefined, targetType: undefined, archived: true }),
    ).toBe(1);
  });

  it("sums all three when every field is set", () => {
    expect(
      computeQuoteActiveFilterCount({ status: "SENT", targetType: "CLIENT", archived: true }),
    ).toBe(3);
  });

  it("archived=false never contributes, even when every other field is set", () => {
    expect(
      computeQuoteActiveFilterCount({ status: "CONVERTED", targetType: "CLIENT", archived: false }),
    ).toBe(2);
  });
});
