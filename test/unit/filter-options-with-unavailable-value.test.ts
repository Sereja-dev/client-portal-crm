import { describe, expect, it } from "vitest";
import { buildFilterOptionsWithUnavailableValue } from "@/lib/list-params";

/**
 * Stale custom-status filter hardening — narrow pure-function coverage
 * for the one shared helper that gives an already-fail-closed-at-the-
 * query-level, unresolved status/stage key a real matching <option> so
 * the existing uncontrolled <select> (Clients/Projects/Leads List)
 * renders it truthfully instead of silently falling back to "All
 * statuses"/"All stages". Deliberately the domain-neutral twin of
 * contracts/query.ts's own buildContractEntityFilterOptions — see this
 * function's own header comment (list-params.ts) for why that one is
 * left untouched rather than reused directly.
 */
describe("buildFilterOptionsWithUnavailableValue", () => {
  const baseOptions = [
    { value: "", label: "All statuses" },
    { value: "active", label: "Active" },
    { value: "archived-key", label: "Archived Thing (archived)" },
  ];

  it("undefined selected value -> options unchanged", () => {
    const result = buildFilterOptionsWithUnavailableValue(baseOptions, undefined, "Unavailable status");
    expect(result).toEqual(baseOptions);
  });

  it("empty-string selected value -> options unchanged (treated the same as undefined)", () => {
    const result = buildFilterOptionsWithUnavailableValue(baseOptions, "", "Unavailable status");
    expect(result).toEqual(baseOptions);
  });

  it("selected value already present (a genuinely valid key) -> options unchanged, no sentinel", () => {
    const result = buildFilterOptionsWithUnavailableValue(baseOptions, "active", "Unavailable status");
    expect(result).toEqual(baseOptions);
    expect(result).toHaveLength(3);
  });

  it("selected value matches the already-appended archived entry -> options unchanged, no second sentinel", () => {
    const result = buildFilterOptionsWithUnavailableValue(baseOptions, "archived-key", "Unavailable status");
    expect(result).toEqual(baseOptions);
  });

  it("missing/unresolved selected value -> exactly one sentinel option appended", () => {
    const result = buildFilterOptionsWithUnavailableValue(baseOptions, "never-existed-key", "Unavailable status");
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ value: "never-existed-key", label: "Unavailable status" });
  });

  it("the unavailable label is used exactly as given -- never a derived/guessed variant", () => {
    const result = buildFilterOptionsWithUnavailableValue(baseOptions, "ghost-stage", "Unavailable stage");
    const sentinel = result.find((o) => o.value === "ghost-stage");
    expect(sentinel?.label).toBe("Unavailable stage");
  });

  it("the raw selected key is never used as the label", () => {
    const result = buildFilterOptionsWithUnavailableValue(baseOptions, "totally-made-up-key-xyz", "Unavailable status");
    const sentinel = result.find((o) => o.value === "totally-made-up-key-xyz");
    expect(sentinel?.label).not.toContain("totally-made-up-key-xyz");
    expect(sentinel?.label).toBe("Unavailable status");
  });

  it("every existing option remains present and unchanged when a sentinel is appended", () => {
    const result = buildFilterOptionsWithUnavailableValue(baseOptions, "ghost-key", "Unavailable status");
    expect(result.slice(0, 3)).toEqual(baseOptions);
  });

  it("repeated invocation never duplicates the sentinel once the value is actually valid", () => {
    const once = buildFilterOptionsWithUnavailableValue(baseOptions, "active", "Unavailable status");
    const twice = buildFilterOptionsWithUnavailableValue(once, "active", "Unavailable status");
    expect(twice).toHaveLength(3);
  });

  it("works identically for a different generic label (Leads' own 'Unavailable stage')", () => {
    const stageOptions = [
      { value: "", label: "All stages" },
      { value: "new", label: "New" },
    ];
    const result = buildFilterOptionsWithUnavailableValue(stageOptions, "stale-stage-key", "Unavailable stage");
    expect(result).toEqual([...stageOptions, { value: "stale-stage-key", label: "Unavailable stage" }]);
  });
});
