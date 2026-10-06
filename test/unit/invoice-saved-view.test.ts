import { describe, expect, it } from "vitest";
import { serializeInvoiceSavedViewParams, buildInvoiceHrefFromSavedViewParams } from "@/app/(dashboard)/invoices/saved-view";

/**
 * Tables Improvement Slice D1 — narrow pure-function coverage for the
 * Invoice Saved Views allowlist: `serializeInvoiceSavedViewParams`
 * (what gets STORED on Save) and `buildInvoiceHrefFromSavedViewParams`
 * (what gets READ back on Apply). Both are intentionally tiny and
 * Prisma-free (see that module's own header comment on why) — this file
 * never imports `invoices/query.ts` or Prisma itself, matching the
 * production code's own bundle-boundary discipline.
 */
describe("serializeInvoiceSavedViewParams", () => {
  it("includes q, status, and sort when all three are present", () => {
    const result = serializeInvoiceSavedViewParams({ q: "acme", status: "SENT", sortCombined: "dueDate:asc" });
    expect(result).toEqual({ q: "acme", status: "SENT", sort: "dueDate:asc" });
  });

  it("never includes page -- page is not part of InvoiceListParams' own serialized shape at all", () => {
    const result = serializeInvoiceSavedViewParams({ q: "", status: undefined, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("page");
  });

  it("omits an empty q entirely, rather than storing q: ''", () => {
    const result = serializeInvoiceSavedViewParams({ q: "", status: "DRAFT", sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("q");
  });

  it("omits an absent status entirely, rather than storing status: ''", () => {
    const result = serializeInvoiceSavedViewParams({ q: "acme", status: undefined, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("status");
  });

  it("includes only the three allowlisted fields -- no stray keys", () => {
    const result = serializeInvoiceSavedViewParams({ q: "acme", status: "PAID", sortCombined: "amount:desc" });
    expect(Object.keys(result).sort()).toEqual(["q", "sort", "status"]);
  });
});

describe("buildInvoiceHrefFromSavedViewParams", () => {
  it("builds a full /invoices href from all three allowed keys", () => {
    expect(buildInvoiceHrefFromSavedViewParams({ q: "acme", status: "SENT", sort: "dueDate:asc" })).toBe(
      "/invoices?q=acme&status=SENT&sort=dueDate%3Aasc",
    );
  });

  it("returns the bare /invoices path when params is empty", () => {
    expect(buildInvoiceHrefFromSavedViewParams({})).toBe("/invoices");
  });

  it("ignores an unknown stored key entirely -- never replayed into the URL", () => {
    const href = buildInvoiceHrefFromSavedViewParams({ q: "acme", page: "3", someFutureField: "x" });
    expect(href).toBe("/invoices?q=acme");
    expect(href).not.toContain("page");
    expect(href).not.toContain("someFutureField");
  });

  it("never emits page even if a malformed/hand-edited stored view contains one", () => {
    const href = buildInvoiceHrefFromSavedViewParams({ page: "2" });
    expect(href).toBe("/invoices");
  });
});
