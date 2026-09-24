import { describe, expect, it } from "vitest";
import { parseTaskListParams } from "@/app/(dashboard)/tasks/query";

/**
 * Dashboard Redesign — the ?overdue=true Tasks list filter. Pure parser
 * coverage (no DB) — see test/integration/tasks/overdue-filter.test.ts
 * for the real query/DB-level composition proof.
 */
describe("parseTaskListParams — overdue", () => {
  it("accepts the exact literal 'overdue=true'", () => {
    const params = parseTaskListParams({ overdue: "true" });
    expect(params.overdue).toBe(true);
  });

  it("is false when the param is absent", () => {
    const params = parseTaskListParams({});
    expect(params.overdue).toBe(false);
  });

  it("is false for any non-exact value ('false', '1', 'yes', 'TRUE')", () => {
    for (const value of ["false", "1", "yes", "TRUE", ""]) {
      expect(parseTaskListParams({ overdue: value }).overdue).toBe(false);
    }
  });

  it("takes the first value when given an array (mirrors every other list param's own convention)", () => {
    expect(parseTaskListParams({ overdue: ["true", "false"] }).overdue).toBe(true);
    expect(parseTaskListParams({ overdue: ["false", "true"] }).overdue).toBe(false);
  });

  it("composes with q/status/priority/sort/page without interfering", () => {
    const params = parseTaskListParams({ overdue: "true", q: "invoice", status: "TODO", priority: "HIGH", sort: "dueDate:asc", page: "2" });
    expect(params).toMatchObject({
      overdue: true,
      q: "invoice",
      status: "TODO",
      priority: "HIGH",
      sortField: "dueDate",
      sortDir: "asc",
      page: 2,
    });
  });
});
