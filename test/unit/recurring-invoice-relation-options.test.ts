import { describe, expect, it } from "vitest";
import {
  toClientOptions,
  toProjectOptions,
  NO_PROJECT_OPTION,
} from "@/components/recurring-invoices/recurring-invoice-relation-options";

/**
 * Forms Improvement Slice A2.2 §20 — focused coverage for the pure
 * mapping helper this slice introduces (deliberately a separate,
 * duplicate file from A2.1's own invoice-relation-options.ts — see this
 * module's own header comment for why). Never duplicates
 * resolveRecurringInvoiceTarget's own already-covered server-side
 * tests (test/integration/recurring-invoices/management.test.ts).
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
    expect(toClientOptions(clients).map((o) => o.value)).toEqual(["c3", "c1", "c2"]);
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
    expect(toProjectOptions([])).toEqual([{ value: "", label: "No project" }]);
  });

  it("maps only the already-client-filtered projects after 'No project', preserving their order", () => {
    const projects = [
      { id: "p2", label: "Phase 2" },
      { id: "p1", label: "Phase 1" },
    ];
    expect(toProjectOptions(projects)).toEqual([
      { value: "", label: "No project" },
      { value: "p2", label: "Phase 2" },
      { value: "p1", label: "Phase 1" },
    ]);
  });

  it("the empty ('No project') value is preserved exactly as the empty string, never null/undefined", () => {
    const options = toProjectOptions([]);
    expect(options[0].value).toBe("");
    expect(typeof options[0].value).toBe("string");
  });
});
