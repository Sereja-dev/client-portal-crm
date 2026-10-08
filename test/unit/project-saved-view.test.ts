import { describe, expect, it } from "vitest";
import { serializeProjectSavedViewParams, buildProjectHrefFromSavedViewParams } from "@/app/(dashboard)/projects/saved-view";

/**
 * Tables Improvement Slice D2B — narrow pure-function coverage for the
 * Projects Saved Views allowlist: `serializeProjectSavedViewParams`
 * (what gets STORED on Save) and `buildProjectHrefFromSavedViewParams`
 * (what gets READ back on Apply). Mirrors client-saved-view.test.ts's
 * own identical shape (minus `tag`, which Projects has no equivalent
 * of); this file never imports `projects/query.ts` or Prisma itself,
 * matching the production code's own bundle-boundary discipline.
 */
describe("serializeProjectSavedViewParams", () => {
  it("includes q, status, and sort when all are present", () => {
    const result = serializeProjectSavedViewParams({ q: "acme", status: "in-progress", sortCombined: "name:asc" });
    expect(result).toEqual({ q: "acme", status: "in-progress", sort: "name:asc" });
  });

  it("never includes page -- page is not part of ProjectListParams' own serialized shape at all", () => {
    const result = serializeProjectSavedViewParams({ q: "", status: undefined, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("page");
  });

  it("omits an empty q entirely, rather than storing q: ''", () => {
    const result = serializeProjectSavedViewParams({ q: "", status: "in-progress", sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("q");
  });

  it("omits an absent status entirely, rather than storing an empty string", () => {
    const result = serializeProjectSavedViewParams({ q: "acme", status: undefined, sortCombined: "createdAt:desc" });
    expect(result).not.toHaveProperty("status");
  });

  it("preserves a stale/unresolved status key verbatim -- this module performs no resolution against live CustomStatusDefinition rows (D2B §11, intentional)", () => {
    const result = serializeProjectSavedViewParams({ q: "", status: "typo-key-never-existed", sortCombined: "" });
    expect(result.status).toBe("typo-key-never-existed");
  });

  it("preserves an archived-but-real status key verbatim, same as any other key (D2B §12)", () => {
    const result = serializeProjectSavedViewParams({ q: "", status: "archived-status", sortCombined: "" });
    expect(result.status).toBe("archived-status");
  });

  it("includes only the three allowlisted fields -- no stray keys", () => {
    const result = serializeProjectSavedViewParams({ q: "acme", status: "in-progress", sortCombined: "name:desc" });
    expect(Object.keys(result).sort()).toEqual(["q", "sort", "status"]);
  });
});

describe("buildProjectHrefFromSavedViewParams", () => {
  it("builds a full /projects href from all three allowed keys", () => {
    const href = buildProjectHrefFromSavedViewParams({ q: "acme", status: "in-progress", sort: "name:asc" });
    expect(href).toBe("/projects?q=acme&status=in-progress&sort=name%3Aasc");
  });

  it("returns the bare /projects path when params is empty", () => {
    expect(buildProjectHrefFromSavedViewParams({})).toBe("/projects");
  });

  it("ignores an unknown stored key entirely -- never replayed into the URL", () => {
    const href = buildProjectHrefFromSavedViewParams({ q: "acme", page: "3", someFutureField: "x" });
    expect(href).toBe("/projects?q=acme");
    expect(href).not.toContain("page");
    expect(href).not.toContain("someFutureField");
  });

  it("never emits page even if a malformed/hand-edited stored view contains one", () => {
    expect(buildProjectHrefFromSavedViewParams({ page: "2" })).toBe("/projects");
  });

  it("never merges with any unrelated current-page state -- it only ever reads from the given params object", () => {
    const href = buildProjectHrefFromSavedViewParams({ status: "in-progress" });
    expect(href).toBe("/projects?status=in-progress");
  });

  it("replays a stale/unresolved status key straight through into the URL unchanged (D2B §11, intentional fail-closed round-trip)", () => {
    expect(buildProjectHrefFromSavedViewParams({ status: "typo-key-never-existed" })).toBe("/projects?status=typo-key-never-existed");
  });

  it("replays an archived-but-real status key straight through into the URL unchanged (D2B §12)", () => {
    expect(buildProjectHrefFromSavedViewParams({ status: "archived-status" })).toBe("/projects?status=archived-status");
  });
});
