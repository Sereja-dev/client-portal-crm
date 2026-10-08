import { describe, expect, it } from "vitest";
import { serializeClientSavedViewParams, buildClientHrefFromSavedViewParams } from "@/app/(dashboard)/clients/saved-view";

/**
 * Tables Improvement Slice D2B — narrow pure-function coverage for the
 * Clients Saved Views allowlist: `serializeClientSavedViewParams` (what
 * gets STORED on Save) and `buildClientHrefFromSavedViewParams` (what
 * gets READ back on Apply). Mirrors quote-saved-view.test.ts's own
 * identical shape; this file never imports `clients/query.ts` or Prisma
 * itself, matching the production code's own bundle-boundary
 * discipline. The shared Saved Views hook/store/control themselves are
 * already exhaustively covered by their own D1 test files — not
 * duplicated here.
 */
describe("serializeClientSavedViewParams", () => {
  it("includes q, status, tag, and sort when all are present", () => {
    const result = serializeClientSavedViewParams({
      q: "acme",
      status: "active",
      tagId: "11111111-1111-1111-1111-111111111111",
      sortCombined: "name:asc",
    });
    expect(result).toEqual({
      q: "acme",
      status: "active",
      tag: "11111111-1111-1111-1111-111111111111",
      sort: "name:asc",
    });
  });

  it("never includes page -- page is not part of ClientListParams' own serialized shape at all", () => {
    const result = serializeClientSavedViewParams({ q: "", status: undefined, tagId: undefined, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("page");
  });

  it("omits an empty q entirely, rather than storing q: ''", () => {
    const result = serializeClientSavedViewParams({ q: "", status: "active", tagId: undefined, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("q");
  });

  it("omits an absent status/tagId entirely, rather than storing an empty string", () => {
    const result = serializeClientSavedViewParams({ q: "acme", status: undefined, tagId: undefined, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("tag");
  });

  it("preserves a stale/unresolved status key verbatim -- this module performs no resolution against live CustomStatusDefinition rows (D2B §11, intentional)", () => {
    const result = serializeClientSavedViewParams({ q: "", status: "typo-key-never-existed", tagId: undefined, sortCombined: "" });
    expect(result.status).toBe("typo-key-never-existed");
  });

  it("preserves an archived-but-real status key verbatim, same as any other key (D2B §12)", () => {
    const result = serializeClientSavedViewParams({ q: "", status: "archived-status", tagId: undefined, sortCombined: "" });
    expect(result.status).toBe("archived-status");
  });

  it("stores tagId under the `tag` key, matching the URL param name, not the parsed field name", () => {
    const result = serializeClientSavedViewParams({
      q: "",
      status: undefined,
      tagId: "22222222-2222-2222-2222-222222222222",
      sortCombined: "",
    });
    expect(result).toHaveProperty("tag", "22222222-2222-2222-2222-222222222222");
    expect(result).not.toHaveProperty("tagId");
  });

  it("includes only the four allowlisted fields -- no stray keys", () => {
    const result = serializeClientSavedViewParams({
      q: "acme",
      status: "active",
      tagId: "33333333-3333-3333-3333-333333333333",
      sortCombined: "name:desc",
    });
    expect(Object.keys(result).sort()).toEqual(["q", "sort", "status", "tag"]);
  });
});

describe("buildClientHrefFromSavedViewParams", () => {
  it("builds a full /clients href from all four allowed keys", () => {
    const href = buildClientHrefFromSavedViewParams({
      q: "acme",
      status: "active",
      tag: "11111111-1111-1111-1111-111111111111",
      sort: "name:asc",
    });
    expect(href).toBe("/clients?q=acme&status=active&tag=11111111-1111-1111-1111-111111111111&sort=name%3Aasc");
  });

  it("returns the bare /clients path when params is empty", () => {
    expect(buildClientHrefFromSavedViewParams({})).toBe("/clients");
  });

  it("ignores an unknown stored key entirely -- never replayed into the URL", () => {
    const href = buildClientHrefFromSavedViewParams({ q: "acme", page: "3", someFutureField: "x" });
    expect(href).toBe("/clients?q=acme");
    expect(href).not.toContain("page");
    expect(href).not.toContain("someFutureField");
  });

  it("never emits page even if a malformed/hand-edited stored view contains one", () => {
    expect(buildClientHrefFromSavedViewParams({ page: "2" })).toBe("/clients");
  });

  it("never merges with any unrelated current-page state -- it only ever reads from the given params object", () => {
    const href = buildClientHrefFromSavedViewParams({ status: "active" });
    expect(href).toBe("/clients?status=active");
  });

  it("replays a stale/unresolved status key straight through into the URL unchanged (D2B §11, intentional fail-closed round-trip)", () => {
    expect(buildClientHrefFromSavedViewParams({ status: "typo-key-never-existed" })).toBe("/clients?status=typo-key-never-existed");
  });

  it("replays an archived-but-real status key straight through into the URL unchanged (D2B §12)", () => {
    expect(buildClientHrefFromSavedViewParams({ status: "archived-status" })).toBe("/clients?status=archived-status");
  });

  it("replays a tag id straight through into the URL unchanged, whether or not it still resolves to any assignment", () => {
    expect(buildClientHrefFromSavedViewParams({ tag: "44444444-4444-4444-4444-444444444444" })).toBe(
      "/clients?tag=44444444-4444-4444-4444-444444444444",
    );
  });
});
