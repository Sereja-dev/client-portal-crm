import { describe, expect, it } from "vitest";
import { computeInvoiceActiveFilterCount } from "@/app/(dashboard)/invoices/query";

/**
 * Mobile Improvement Slice B2 — the exact, Product-approved active-count
 * rule for Invoices' own mobile Filter disclosure: status alone, worth
 * at most 1 — the quick-filter chips share this exact same `status`
 * param, so there is only ever one value to count regardless of which
 * control set it (never double-counted). q and sort are excluded
 * entirely (not even representable — see the function's own
 * `Pick<...>` signature).
 */
describe("computeInvoiceActiveFilterCount", () => {
  it("is 0 when status is not set", () => {
    expect(computeInvoiceActiveFilterCount({ status: undefined })).toBe(0);
  });

  it("is 1 when status is set (whether by dropdown or quick chip, the param is identical)", () => {
    expect(computeInvoiceActiveFilterCount({ status: "DRAFT" })).toBe(1);
  });
});
