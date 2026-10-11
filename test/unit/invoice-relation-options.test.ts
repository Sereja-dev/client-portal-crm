import { describe, expect, it } from "vitest";
import { toClientOptions, toProjectOptions, NO_PROJECT_OPTION } from "@/components/invoices/invoice-relation-options";

/**
 * Forms Improvement Slice A2.1 §21 — focused coverage for the one pure
 * mapping helper this pilot introduces. These are plain data
 * transformations, never a server resolver re-check (that's already
 * covered by test/integration/invoices/target.test.ts and untouched by
 * this slice) — no duplication of that coverage here.
 */

describe("toClientOptions", () => {
  it("maps id -> value and name -> label", () => {
    const options = toClientOptions([{ id: "c1", name: "Acme Inc" }]);
    expect(options).toEqual([{ value: "c1", label: "Acme Inc" }]);
  });

  it("preserves the caller's own order exactly — never re-sorts", () => {
    const clients = [
      { id: "c3", name: "Zeta Co" },
      { id: "c1", name: "Acme Inc" },
      { id: "c2", name: "Beta LLC" },
    ];
    const options = toClientOptions(clients);
    expect(options.map((o) => o.value)).toEqual(["c3", "c1", "c2"]);
  });

  it("introduces no extra fields beyond value/label", () => {
    const options = toClientOptions([{ id: "c1", name: "Acme Inc" }]);
    expect(Object.keys(options[0]).sort()).toEqual(["label", "value"]);
  });

  it("an empty client list produces an empty option list", () => {
    expect(toClientOptions([])).toEqual([]);
  });
});

describe("toProjectOptions", () => {
  it("'No project' is always first, with the exact value/label the retired native <option> used", () => {
    const options = toProjectOptions([{ id: "p1", label: "Website redesign" }]);
    expect(options[0]).toEqual({ value: "", label: "No project" });
    expect(NO_PROJECT_OPTION).toEqual({ value: "", label: "No project" });
  });

  it("'No project' remains present and first even when the caller's project list is empty", () => {
    const options = toProjectOptions([]);
    expect(options).toEqual([{ value: "", label: "No project" }]);
  });

  it("maps the already-client-filtered projects after 'No project', preserving their order", () => {
    const projects = [
      { id: "p2", label: "Phase 2" },
      { id: "p1", label: "Phase 1" },
    ];
    const options = toProjectOptions(projects);
    expect(options).toEqual([
      { value: "", label: "No project" },
      { value: "p2", label: "Phase 2" },
      { value: "p1", label: "Phase 1" },
    ]);
  });

  it("introduces no extra fields beyond value/label on real project options either", () => {
    const options = toProjectOptions([{ id: "p1", label: "Website redesign" }]);
    for (const option of options) {
      expect(Object.keys(option).sort()).toEqual(["label", "value"]);
    }
  });

  it("never includes a project belonging to a different Client — relies entirely on the caller's own pre-filtering, performs no filtering of its own", () => {
    // toProjectOptions trusts its input completely — this test documents
    // that contract: passing an already-wrong-Client project through
    // still maps it, proving the exclusion responsibility stays with the
    // caller's own `projects.filter(p => p.clientId === clientId)` (see
    // invoice-form.tsx), never silently duplicated or re-checked here.
    const foreignProject = [{ id: "p-foreign", label: "Belongs to a different Client" }];
    expect(toProjectOptions(foreignProject)).toEqual([
      { value: "", label: "No project" },
      { value: "p-foreign", label: "Belongs to a different Client" },
    ]);
  });
});
