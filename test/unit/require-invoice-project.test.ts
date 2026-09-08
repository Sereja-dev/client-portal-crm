import { describe, expect, it } from "vitest";
import { InvoiceProjectInvariantError, requireInvoiceProject, requireInvoiceProjectId } from "@/lib/invoices/require-invoice-project";

/**
 * Quotes / Estimates Phase 2.2b — the TRANSITIONAL compile-safety helper
 * (src/lib/invoices/require-invoice-project.ts's own header comment has
 * the full staged-rollout context). Pure, no Prisma/DB — proves only the
 * helper's own narrowing/throwing contract, never a project-less Invoice
 * product flow (that belongs to Phase 2.3).
 */
describe("requireInvoiceProject", () => {
  it("1. passes a non-null Project object through unchanged", () => {
    const project = { name: "Website Redesign" };
    expect(requireInvoiceProject(project, "test context")).toBe(project);
  });

  it("2. throws InvoiceProjectInvariantError for a null Project", () => {
    expect(() => requireInvoiceProject(null, "test context")).toThrow(InvoiceProjectInvariantError);
  });

  it("includes the given context in the thrown error's message", () => {
    try {
      requireInvoiceProject(null, "dashboard overdue invoices list");
      expect.unreachable("expected requireInvoiceProject to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvoiceProjectInvariantError);
      expect((err as Error).message).toContain("dashboard overdue invoices list");
    }
  });
});

describe("requireInvoiceProjectId", () => {
  it("1. passes a non-null projectId string through unchanged", () => {
    expect(requireInvoiceProjectId("11111111-1111-1111-1111-111111111111", "test context")).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("2. throws InvoiceProjectInvariantError for a null projectId", () => {
    expect(() => requireInvoiceProjectId(null, "test context")).toThrow(InvoiceProjectInvariantError);
  });
});
