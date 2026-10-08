import { describe, expect, it } from "vitest";
import { serializeQuoteSavedViewParams, buildQuoteHrefFromSavedViewParams } from "@/app/(dashboard)/quotes/saved-view";

/**
 * Tables Improvement Slice D2A — narrow pure-function coverage for the
 * Quotes Saved Views allowlist: `serializeQuoteSavedViewParams` (what
 * gets STORED on Save) and `buildQuoteHrefFromSavedViewParams` (what
 * gets READ back on Apply). Mirrors invoice-saved-view.test.ts/
 * contract-saved-view.test.ts's own identical shape; this file never
 * imports `quotes/query.ts` or Prisma itself, matching the production
 * code's own bundle-boundary discipline. The shared Saved Views
 * hook/store/control themselves are already exhaustively covered by
 * their own D1 test files — not duplicated here.
 */
describe("serializeQuoteSavedViewParams", () => {
  it("includes q, status, targetType, archived, and sort when all are present", () => {
    const result = serializeQuoteSavedViewParams({
      q: "acme",
      status: "SENT",
      targetType: "CLIENT",
      archived: true,
      sortCombined: "total:desc",
    });
    expect(result).toEqual({ q: "acme", status: "SENT", targetType: "CLIENT", archived: "1", sort: "total:desc" });
  });

  it("never includes page -- page is not part of QuoteListParams' own serialized shape at all", () => {
    const result = serializeQuoteSavedViewParams({ q: "", status: undefined, targetType: undefined, archived: false, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("page");
  });

  it("omits an empty q entirely, rather than storing q: ''", () => {
    const result = serializeQuoteSavedViewParams({ q: "", status: "DRAFT", targetType: undefined, archived: false, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("q");
  });

  it("omits an absent status/targetType entirely, rather than storing an empty string", () => {
    const result = serializeQuoteSavedViewParams({ q: "acme", status: undefined, targetType: undefined, archived: false, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("targetType");
  });

  it("omits archived entirely when false, rather than storing archived: '0'", () => {
    const result = serializeQuoteSavedViewParams({ q: "", status: undefined, targetType: undefined, archived: false, sortCombined: "" });
    expect(result).not.toHaveProperty("archived");
  });

  it("preserves a derived EXPIRED status value verbatim -- it's just a fixed canonical string, nothing special to encode", () => {
    const result = serializeQuoteSavedViewParams({ q: "", status: "EXPIRED", targetType: undefined, archived: false, sortCombined: "" });
    expect(result.status).toBe("EXPIRED");
  });

  it("preserves a derived CONVERTED status value verbatim", () => {
    const result = serializeQuoteSavedViewParams({ q: "", status: "CONVERTED", targetType: undefined, archived: false, sortCombined: "" });
    expect(result.status).toBe("CONVERTED");
  });

  it("includes only the five allowlisted fields -- no stray keys", () => {
    const result = serializeQuoteSavedViewParams({ q: "acme", status: "APPROVED", targetType: "LEAD", archived: true, sortCombined: "issueDate:desc" });
    expect(Object.keys(result).sort()).toEqual(["archived", "q", "sort", "status", "targetType"]);
  });
});

describe("buildQuoteHrefFromSavedViewParams", () => {
  it("builds a full /quotes href from all five allowed keys", () => {
    const href = buildQuoteHrefFromSavedViewParams({ q: "acme", status: "SENT", targetType: "CLIENT", archived: "1", sort: "total:desc" });
    expect(href).toBe("/quotes?q=acme&status=SENT&targetType=CLIENT&archived=1&sort=total%3Adesc");
  });

  it("returns the bare /quotes path when params is empty", () => {
    expect(buildQuoteHrefFromSavedViewParams({})).toBe("/quotes");
  });

  it("ignores an unknown stored key entirely -- never replayed into the URL", () => {
    const href = buildQuoteHrefFromSavedViewParams({ q: "acme", page: "3", someFutureField: "x" });
    expect(href).toBe("/quotes?q=acme");
    expect(href).not.toContain("page");
    expect(href).not.toContain("someFutureField");
  });

  it("never emits page even if a malformed/hand-edited stored view contains one", () => {
    expect(buildQuoteHrefFromSavedViewParams({ page: "2" })).toBe("/quotes");
  });

  it("never merges with any unrelated current-page state -- it only ever reads from the given params object", () => {
    const href = buildQuoteHrefFromSavedViewParams({ status: "DRAFT" });
    expect(href).toBe("/quotes?status=DRAFT");
  });

  it("replays a derived EXPIRED status straight through into the URL unchanged", () => {
    expect(buildQuoteHrefFromSavedViewParams({ status: "EXPIRED" })).toBe("/quotes?status=EXPIRED");
  });

  it("replays a derived CONVERTED status straight through into the URL unchanged", () => {
    expect(buildQuoteHrefFromSavedViewParams({ status: "CONVERTED" })).toBe("/quotes?status=CONVERTED");
  });
});
