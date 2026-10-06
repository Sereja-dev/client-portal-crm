import { describe, expect, it } from "vitest";
import { serializeContractSavedViewParams, buildContractHrefFromSavedViewParams } from "@/app/(dashboard)/contracts/saved-view";

const STALE_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Tables Improvement Slice D1 — narrow pure-function coverage for the
 * Contract Saved Views allowlist. Mirrors invoice-saved-view.test.ts's
 * own shape; the one Contract-specific requirement this file exists to
 * prove is locked spec §29/§37: a stale client/project id is preserved
 * verbatim through serialize, never dropped or canonicalized away.
 */
describe("serializeContractSavedViewParams", () => {
  it("includes exactly the six allowlisted fields when all are present", () => {
    const result = serializeContractSavedViewParams({
      q: "acme",
      status: "SENT",
      clientId: "client-1",
      projectId: "project-1",
      archived: true,
      sortCombined: "issueDate:asc",
    });
    expect(result).toEqual({
      q: "acme",
      status: "SENT",
      client: "client-1",
      project: "project-1",
      archived: "1",
      sort: "issueDate:asc",
    });
  });

  it("omits archived entirely when false, rather than storing archived: '0'", () => {
    const result = serializeContractSavedViewParams({
      q: "",
      status: undefined,
      clientId: undefined,
      projectId: undefined,
      archived: false,
      sortCombined: "",
    });
    expect(result).not.toHaveProperty("archived");
  });

  it("never includes bulk-selection or row-menu state -- it never receives any such input at all", () => {
    const result = serializeContractSavedViewParams({
      q: "acme",
      status: "DRAFT",
      clientId: "client-1",
      projectId: undefined,
      archived: false,
      sortCombined: "issueDate:desc",
    });
    expect(Object.keys(result).sort()).toEqual(["client", "q", "sort", "status"]);
  });

  it("preserves a stale (nonexistent) client UUID verbatim -- never dropped, never canonicalized away", () => {
    const result = serializeContractSavedViewParams({
      q: "",
      status: undefined,
      clientId: STALE_UUID,
      projectId: undefined,
      archived: false,
      sortCombined: "",
    });
    expect(result.client).toBe(STALE_UUID);
  });

  it("preserves a stale (nonexistent) project UUID verbatim", () => {
    const result = serializeContractSavedViewParams({
      q: "",
      status: undefined,
      clientId: undefined,
      projectId: STALE_UUID,
      archived: false,
      sortCombined: "",
    });
    expect(result.project).toBe(STALE_UUID);
  });
});

describe("buildContractHrefFromSavedViewParams", () => {
  it("builds a full /contracts href from all six allowed keys", () => {
    const href = buildContractHrefFromSavedViewParams({
      q: "acme",
      status: "SENT",
      client: "client-1",
      project: "project-1",
      archived: "1",
      sort: "issueDate:asc",
    });
    expect(href).toBe("/contracts?q=acme&status=SENT&client=client-1&project=project-1&archived=1&sort=issueDate%3Aasc");
  });

  it("returns the bare /contracts path when params is empty", () => {
    expect(buildContractHrefFromSavedViewParams({})).toBe("/contracts");
  });

  it("ignores an unknown stored key entirely", () => {
    const href = buildContractHrefFromSavedViewParams({ q: "acme", selectedIds: "a,b,c" });
    expect(href).toBe("/contracts?q=acme");
    expect(href).not.toContain("selectedIds");
  });

  it("replays a stale client id straight through into the URL unchanged -- this is the fail-closed contract the stale-entity-filter fix depends on", () => {
    const href = buildContractHrefFromSavedViewParams({ client: STALE_UUID });
    expect(href).toBe(`/contracts?client=${STALE_UUID}`);
  });

  it("replays a stale project id straight through into the URL unchanged", () => {
    const href = buildContractHrefFromSavedViewParams({ project: STALE_UUID });
    expect(href).toBe(`/contracts?project=${STALE_UUID}`);
  });
});
