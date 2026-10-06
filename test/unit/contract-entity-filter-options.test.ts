import { describe, expect, it } from "vitest";
import { buildContractEntityFilterOptions } from "@/app/(dashboard)/contracts/query";

/**
 * Contract stale entity filter remediation — narrow pure-function
 * coverage for buildContractEntityFilterOptions, the one helper that
 * gives an already-active, already-correctly-queried stale/foreign
 * Client/Project filter a real matching <option> so the existing
 * uncontrolled <select> renders it truthfully instead of silently
 * falling back to "All clients"/"All projects".
 */
describe("buildContractEntityFilterOptions", () => {
  const baseOptions = [
    { value: "", label: "All clients" },
    { value: "client-a", label: "Acme Corp" },
    { value: "client-b", label: "Globex" },
  ];

  it("no selected id -> original options unchanged, no sentinel", () => {
    const result = buildContractEntityFilterOptions(baseOptions, undefined, "Unavailable client");
    expect(result).toEqual(baseOptions);
  });

  it("selected valid id -> original options unchanged, no sentinel", () => {
    const result = buildContractEntityFilterOptions(baseOptions, "client-a", "Unavailable client");
    expect(result).toEqual(baseOptions);
    expect(result).toHaveLength(3);
  });

  it("selected stale id -> exactly one sentinel appended with the exact generic label", () => {
    const result = buildContractEntityFilterOptions(baseOptions, "stale-uuid", "Unavailable client");
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ value: "stale-uuid", label: "Unavailable client" });
  });

  it("the raw stale id is never used as the label -- only the fixed generic label", () => {
    const result = buildContractEntityFilterOptions(baseOptions, "11111111-2222-3333-4444-555555555555", "Unavailable client");
    const sentinel = result.find((o) => o.value === "11111111-2222-3333-4444-555555555555");
    expect(sentinel?.label).toBe("Unavailable client");
    expect(sentinel?.label).not.toContain("1111");
  });

  it("every existing option remains present, unchanged, when a sentinel is appended", () => {
    const result = buildContractEntityFilterOptions(baseOptions, "stale-uuid", "Unavailable client");
    expect(result.slice(0, 3)).toEqual(baseOptions);
  });

  it("never duplicates a sentinel when the id is actually valid, even across repeated calls", () => {
    const once = buildContractEntityFilterOptions(baseOptions, "client-b", "Unavailable client");
    const twice = buildContractEntityFilterOptions(once, "client-b", "Unavailable client");
    expect(twice).toHaveLength(3);
  });

  it("works identically with a different generic label (e.g. the Project filter's own)", () => {
    const projectOptions = [
      { value: "", label: "All projects" },
      { value: "proj-a", label: "Website Redesign" },
    ];
    const result = buildContractEntityFilterOptions(projectOptions, "stale-project-id", "Unavailable project");
    expect(result).toEqual([...projectOptions, { value: "stale-project-id", label: "Unavailable project" }]);
  });
});
