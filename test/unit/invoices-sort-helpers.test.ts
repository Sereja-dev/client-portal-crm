import { describe, expect, it } from "vitest";
import {
  buildInvoicesHref,
  nextInvoiceSortCombined,
  INVOICE_SORT_DEFAULT_DIRECTION,
  INVOICE_QUICK_FILTERS,
  INVOICE_SORT_FIELDS,
} from "@/app/(dashboard)/invoices/query";

/**
 * Tables Improvement Slice A — the Invoice-specific sort/URL helpers
 * clickable headers and quick-filter chips build their own hrefs from.
 * Deliberately domain-owned (not inside the generic SortableHeader/
 * QuickFilterChips primitives themselves) — see those components' own
 * header comments for the "domain-independent logic in the primitive,
 * domain defaults in Invoice configuration" split this enforces.
 */

describe("buildInvoicesHref", () => {
  it("omits any falsy/undefined param entirely, never an empty query string value", () => {
    expect(buildInvoicesHref({ q: undefined, status: undefined, sort: "createdAt:desc" })).toBe(
      "/invoices?sort=createdAt%3Adesc",
    );
  });

  it("returns the bare path when every param is falsy", () => {
    expect(buildInvoicesHref({ q: undefined, status: undefined })).toBe("/invoices");
  });

  it("preserves every truthy param together", () => {
    const href = buildInvoicesHref({ q: "acme", status: "SENT", sort: "amount:asc" });
    expect(href).toBe("/invoices?q=acme&status=SENT&sort=amount%3Aasc");
  });

  it("never includes `page` unless explicitly passed — omitting it is how every call site resets pagination to page 1", () => {
    const href = buildInvoicesHref({ q: "acme", status: "SENT", sort: "amount:asc" });
    expect(href).not.toContain("page=");
  });
});

describe("nextInvoiceSortCombined", () => {
  it("clicking a DIFFERENT field always starts at that field's own established default direction", () => {
    expect(nextInvoiceSortCombined({ sortField: "createdAt", sortDir: "desc" }, "dueDate")).toBe("dueDate:asc");
    expect(nextInvoiceSortCombined({ sortField: "dueDate", sortDir: "asc" }, "createdAt")).toBe("createdAt:desc");
    expect(nextInvoiceSortCombined({ sortField: "createdAt", sortDir: "desc" }, "amount")).toBe("amount:desc");
  });

  it("clicking the CURRENTLY ACTIVE field toggles asc <-> desc — never a surprising tri-state cycle", () => {
    expect(nextInvoiceSortCombined({ sortField: "amount", sortDir: "desc" }, "amount")).toBe("amount:asc");
    expect(nextInvoiceSortCombined({ sortField: "amount", sortDir: "asc" }, "amount")).toBe("amount:desc");
  });

  it("every allowlisted field has its own established default direction", () => {
    for (const field of INVOICE_SORT_FIELDS) {
      expect(["asc", "desc"]).toContain(INVOICE_SORT_DEFAULT_DIRECTION[field]);
    }
  });

  it("default directions match the existing Sort-by dropdown's own established option ordering (Due date asc-first, Created desc-first, Amount desc-first)", () => {
    expect(INVOICE_SORT_DEFAULT_DIRECTION.dueDate).toBe("asc");
    expect(INVOICE_SORT_DEFAULT_DIRECTION.createdAt).toBe("desc");
    expect(INVOICE_SORT_DEFAULT_DIRECTION.amount).toBe("desc");
  });
});

describe("INVOICE_QUICK_FILTERS", () => {
  it("exposes exactly the four locked chips, in order: Draft, Sent, Overdue, Paid", () => {
    expect(INVOICE_QUICK_FILTERS.map((f) => f.label)).toEqual(["Draft", "Sent", "Overdue", "Paid"]);
  });

  it("each chip maps to exactly the matching persisted InvoiceStatus value — never a reinterpreted/derived concept", () => {
    expect(INVOICE_QUICK_FILTERS.map((f) => f.status)).toEqual(["DRAFT", "SENT", "OVERDUE", "PAID"]);
  });

  it("CANCELLED is never a quick-filter chip — it stays Status-dropdown-only, per the locked spec", () => {
    expect(INVOICE_QUICK_FILTERS.some((f) => f.status === "CANCELLED")).toBe(false);
  });
});
