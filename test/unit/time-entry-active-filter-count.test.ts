import { describe, expect, it } from "vitest";
import { computeTimeEntryActiveFilterCount } from "@/app/(dashboard)/time/view-params";

/**
 * Mobile Improvement Slice B2 — the exact, Product-approved active-count
 * rule for Time's own mobile Filter disclosure: from/to/projectId/
 * userId/billable, each worth at most 1. `archived` is intentionally
 * excluded — it's controlled by its own separate "Show archived" view
 * switch, never rendered inside this disclosure.
 */
describe("computeTimeEntryActiveFilterCount", () => {
  const empty = { from: undefined, to: undefined, projectId: undefined, userId: undefined, billable: undefined };

  it("is 0 when no field is set", () => {
    expect(computeTimeEntryActiveFilterCount(empty)).toBe(0);
  });

  it("counts from alone as 1", () => {
    expect(computeTimeEntryActiveFilterCount({ ...empty, from: new Date("2026-01-01") })).toBe(1);
  });

  it("counts to alone as 1", () => {
    expect(computeTimeEntryActiveFilterCount({ ...empty, to: new Date("2026-01-31") })).toBe(1);
  });

  it("counts projectId alone as 1", () => {
    expect(computeTimeEntryActiveFilterCount({ ...empty, projectId: "11111111-1111-1111-1111-111111111111" })).toBe(1);
  });

  it("counts userId alone as 1", () => {
    expect(computeTimeEntryActiveFilterCount({ ...empty, userId: "22222222-2222-2222-2222-222222222222" })).toBe(1);
  });

  it("counts billable=false as 1 -- a defined tri-state value, not merely a truthy check", () => {
    expect(computeTimeEntryActiveFilterCount({ ...empty, billable: false })).toBe(1);
  });

  it("counts billable=true as 1", () => {
    expect(computeTimeEntryActiveFilterCount({ ...empty, billable: true })).toBe(1);
  });

  it("sums all five when every field is set", () => {
    expect(
      computeTimeEntryActiveFilterCount({
        from: new Date("2026-01-01"),
        to: new Date("2026-01-31"),
        projectId: "11111111-1111-1111-1111-111111111111",
        userId: "22222222-2222-2222-2222-222222222222",
        billable: true,
      }),
    ).toBe(5);
  });
});
