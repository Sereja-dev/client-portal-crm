import { describe, expect, it } from "vitest";
import { computeTaskActiveFilterCount } from "@/app/(dashboard)/tasks/query";

/**
 * Mobile Improvement Slice B2 — the exact, Product-approved active-count
 * rule for Tasks' own mobile Filter disclosure: status/priority, each
 * worth at most 1. The "High priority" quick-filter chip shares this
 * exact same `priority` param, so there is only ever one value to count
 * regardless of which control set it (never double-counted). q, sort,
 * and view mode are excluded entirely (not even representable — see
 * the function's own `Pick<...>` signature); overdue/mine/dueThisWeek
 * are chip-only booleans with no in-disclosure representation, so they
 * are structurally impossible to pass to this function at all.
 */
describe("computeTaskActiveFilterCount", () => {
  it("is 0 when neither status nor priority is set", () => {
    expect(computeTaskActiveFilterCount({ status: undefined, priority: undefined })).toBe(0);
  });

  it("counts status alone as 1", () => {
    expect(computeTaskActiveFilterCount({ status: "DONE", priority: undefined })).toBe(1);
  });

  it("counts priority alone as 1 (including when set via the High priority quick chip)", () => {
    expect(computeTaskActiveFilterCount({ status: undefined, priority: "HIGH" })).toBe(1);
  });

  it("sums both when both are set", () => {
    expect(computeTaskActiveFilterCount({ status: "TODO", priority: "URGENT" })).toBe(2);
  });
});
