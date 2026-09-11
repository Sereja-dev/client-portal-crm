import { describe, expect, it } from "vitest";
import {
  parseTimeEntryFromDateFilter,
  parseTimeEntryToDateFilter,
  parseTimeEntryProjectFilter,
  parseTimeEntryUserFilter,
  parseTimeEntryBillableFilter,
} from "@/app/(dashboard)/time/view-params";

/**
 * Time Tracking Phase 2A — the Staff list page's own filter param
 * parsing (test items 23, 24, 25, 26, 27, 30). Pure functions, no DB
 * needed — listTimeEntries' own filtering behavior is already covered
 * exhaustively by Phase 1's test/integration/time-entries/list.test.ts.
 */

describe("23/30. parseTimeEntryFromDateFilter", () => {
  it("23. a valid from date parses to UTC midnight on that calendar date", () => {
    const result = parseTimeEntryFromDateFilter({ from: "2026-03-01" });
    expect(result?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("30. a malformed from date is handled safely — undefined, never throws", () => {
    expect(() => parseTimeEntryFromDateFilter({ from: "not-a-date" })).not.toThrow();
    expect(parseTimeEntryFromDateFilter({ from: "not-a-date" })).toBeUndefined();
    expect(parseTimeEntryFromDateFilter({ from: "2026-02-30" })).toBeUndefined();
  });

  it("absent filter is undefined", () => {
    expect(parseTimeEntryFromDateFilter({})).toBeUndefined();
  });
});

describe("24/30. parseTimeEntryToDateFilter", () => {
  it("24. a valid to date parses to UTC midnight on that calendar date", () => {
    const result = parseTimeEntryToDateFilter({ to: "2026-03-31" });
    expect(result?.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("30. a malformed to date is handled safely", () => {
    expect(parseTimeEntryToDateFilter({ to: "13/45/2026" })).toBeUndefined();
  });
});

describe("25. parseTimeEntryProjectFilter", () => {
  it("accepts a well-formed UUID", () => {
    expect(parseTimeEntryProjectFilter({ projectId: "11111111-2222-3333-4444-555555555555" })).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("a malformed projectId is safely ignored, never throws", () => {
    expect(parseTimeEntryProjectFilter({ projectId: "not-a-uuid" })).toBeUndefined();
  });
});

describe("26. parseTimeEntryUserFilter", () => {
  it("accepts a well-formed UUID", () => {
    expect(parseTimeEntryUserFilter({ userId: "11111111-2222-3333-4444-555555555555" })).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("a malformed userId is safely ignored", () => {
    expect(parseTimeEntryUserFilter({ userId: "<script>" })).toBeUndefined();
  });
});

describe("27. parseTimeEntryBillableFilter", () => {
  it("parses 'true'/'false' explicitly, anything else is undefined (no filter)", () => {
    expect(parseTimeEntryBillableFilter({ billable: "true" })).toBe(true);
    expect(parseTimeEntryBillableFilter({ billable: "false" })).toBe(false);
    expect(parseTimeEntryBillableFilter({ billable: "" })).toBeUndefined();
    expect(parseTimeEntryBillableFilter({ billable: "maybe" })).toBeUndefined();
    expect(parseTimeEntryBillableFilter({})).toBeUndefined();
  });
});
