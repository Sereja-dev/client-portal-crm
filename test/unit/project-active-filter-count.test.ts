import { describe, expect, it } from "vitest";
import { computeProjectActiveFilterCount } from "@/app/(dashboard)/projects/query";

/**
 * Mobile Improvement Slice B2 — the exact, Product-approved active-count
 * rule for Projects' own mobile Filter disclosure: status alone, worth
 * at most 1. q and sort are excluded entirely (not even representable —
 * see the function's own `Pick<...>` signature).
 */
describe("computeProjectActiveFilterCount", () => {
  it("is 0 when status is not set", () => {
    expect(computeProjectActiveFilterCount({ status: undefined })).toBe(0);
  });

  it("is 1 when status is set", () => {
    expect(computeProjectActiveFilterCount({ status: "active" })).toBe(1);
  });
});
