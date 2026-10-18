import { describe, expect, it } from "vitest";
import { computeActivityActiveFilterCount } from "@/app/(dashboard)/(insights)/activity/query";

/**
 * Mobile Improvement Slice B2 — the exact, Product-approved active-count
 * rule for Activity's own mobile Filter disclosure: entityType/
 * actionGroup/actorId/dateFrom/dateTo, each worth at most 1. cursor/
 * cursorInvalid are excluded entirely (not even representable — see
 * the function's own `Pick<...>` signature).
 */
describe("computeActivityActiveFilterCount", () => {
  const empty = { entityType: undefined, actionGroup: undefined, actorId: undefined, dateFrom: undefined, dateTo: undefined };

  it("is 0 when no field is set", () => {
    expect(computeActivityActiveFilterCount(empty)).toBe(0);
  });

  it("counts entityType alone as 1", () => {
    expect(computeActivityActiveFilterCount({ ...empty, entityType: "CLIENT" })).toBe(1);
  });

  it("counts actionGroup alone as 1", () => {
    expect(computeActivityActiveFilterCount({ ...empty, actionGroup: "data" })).toBe(1);
  });

  it("counts actorId alone as 1", () => {
    expect(computeActivityActiveFilterCount({ ...empty, actorId: "11111111-1111-1111-1111-111111111111" })).toBe(1);
  });

  it("counts dateFrom alone as 1", () => {
    expect(computeActivityActiveFilterCount({ ...empty, dateFrom: new Date("2026-01-01") })).toBe(1);
  });

  it("counts dateTo alone as 1", () => {
    expect(computeActivityActiveFilterCount({ ...empty, dateTo: new Date("2026-01-31") })).toBe(1);
  });

  it("sums all five when every field is set", () => {
    expect(
      computeActivityActiveFilterCount({
        entityType: "CLIENT",
        actionGroup: "data",
        actorId: "11111111-1111-1111-1111-111111111111",
        dateFrom: new Date("2026-01-01"),
        dateTo: new Date("2026-01-31"),
      }),
    ).toBe(5);
  });
});
