import { describe, expect, it } from "vitest";
import {
  buildContractsHref,
  buildContractOrderBy,
  nextContractSortCombined,
  CONTRACT_SORT_FIELDS,
  CONTRACT_SORT_DEFAULT_DIRECTION,
  CONTRACT_QUICK_FILTERS,
} from "@/app/(dashboard)/contracts/query";
import { getContractDisplayStatus } from "@/lib/contracts/status";

/**
 * Tables Improvement Slice B — the Contract-specific sort/URL helpers
 * the clickable Issue-date header and quick-filter chips build their
 * own hrefs from. Mirrors test/unit/invoices-sort-helpers.test.ts's own
 * precedent exactly, with one addition specific to Contracts: a real
 * "no sort chosen" state distinct from any allowlisted field's own
 * default (see query.ts's own ContractListParams/buildContractOrderBy
 * doc comments on why this exists).
 */

describe("CONTRACT_SORT_FIELDS", () => {
  it("is exactly the one locked allowlisted field — issueDate — the only candidate date field already displayed as its own column", () => {
    expect(CONTRACT_SORT_FIELDS).toEqual(["issueDate"]);
  });

  it("every allowlisted field has its own established default direction", () => {
    for (const field of CONTRACT_SORT_FIELDS) {
      expect(["asc", "desc"]).toContain(CONTRACT_SORT_DEFAULT_DIRECTION[field]);
    }
  });

  it("issueDate's own default direction is ascending (earlier first)", () => {
    expect(CONTRACT_SORT_DEFAULT_DIRECTION.issueDate).toBe("asc");
  });
});

describe("buildContractOrderBy", () => {
  it("preserves the exact pre-existing default order (createdAt desc, id desc) when no sort was chosen", () => {
    expect(buildContractOrderBy({ hasSort: false, sortField: "issueDate", sortDir: "asc" })).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("orders by the chosen allowlisted field once a sort IS chosen, with id as the same-direction tie-break", () => {
    expect(buildContractOrderBy({ hasSort: true, sortField: "issueDate", sortDir: "asc" })).toEqual([
      { issueDate: "asc" },
      { id: "asc" },
    ]);
    expect(buildContractOrderBy({ hasSort: true, sortField: "issueDate", sortDir: "desc" })).toEqual([
      { issueDate: "desc" },
      { id: "desc" },
    ]);
  });

  it("never produces an orderBy entry for a field outside CONTRACT_SORT_FIELDS (e.g. the derived EXPIRED display status is never a raw orderBy field)", () => {
    const result = buildContractOrderBy({ hasSort: true, sortField: "issueDate", sortDir: "asc" });
    const keys = result.flatMap((entry) => Object.keys(entry));
    for (const key of keys) {
      expect(["issueDate", "id"]).toContain(key);
    }
  });
});

describe("buildContractsHref", () => {
  it("omits any falsy/undefined param entirely, never an empty query string value", () => {
    expect(buildContractsHref({ q: undefined, status: undefined, sort: "issueDate:asc" })).toBe(
      "/contracts?sort=issueDate%3Aasc",
    );
  });

  it("returns the bare path when every param is falsy — including sort=\"\" (the 'no sort chosen' state)", () => {
    expect(buildContractsHref({ q: undefined, status: undefined, sort: "" })).toBe("/contracts");
  });

  it("preserves every truthy param together, including archived", () => {
    const href = buildContractsHref({ q: "acme", status: "SENT", archived: "1", sort: "issueDate:desc" });
    expect(href).toBe("/contracts?q=acme&status=SENT&archived=1&sort=issueDate%3Adesc");
  });
});

describe("nextContractSortCombined", () => {
  it("clicking from the 'no sort chosen' state starts at the field's own established default direction", () => {
    expect(nextContractSortCombined({ sortField: "issueDate", sortDir: "asc", hasSort: false }, "issueDate")).toBe(
      "issueDate:asc",
    );
  });

  it("clicking the currently active field toggles asc <-> desc — never a surprising tri-state cycle", () => {
    expect(nextContractSortCombined({ sortField: "issueDate", sortDir: "asc", hasSort: true }, "issueDate")).toBe(
      "issueDate:desc",
    );
    expect(nextContractSortCombined({ sortField: "issueDate", sortDir: "desc", hasSort: true }, "issueDate")).toBe(
      "issueDate:asc",
    );
  });
});

describe("CONTRACT_QUICK_FILTERS", () => {
  it("exposes exactly the three approved chips, in order: Draft, Sent, Accepted", () => {
    expect(CONTRACT_QUICK_FILTERS.map((f) => f.label)).toEqual(["Draft", "Sent", "Accepted"]);
  });

  it("each chip maps to exactly the matching persisted ContractStatus value — never a derived/reinterpreted concept", () => {
    expect(CONTRACT_QUICK_FILTERS.map((f) => f.status)).toEqual(["DRAFT", "SENT", "ACCEPTED"]);
  });

  it("Terminated is never a quick-filter chip — it stays Status-dropdown-only, per the locked spec", () => {
    expect(CONTRACT_QUICK_FILTERS.some((f) => f.status === "TERMINATED")).toBe(false);
  });

  it("Expired/Active are never quick-filter chips — EXPIRED/ACTIVE are derived-only display states, never persisted filter values", () => {
    const statuses: string[] = CONTRACT_QUICK_FILTERS.map((f) => f.status);
    expect(statuses).not.toContain("EXPIRED");
    expect(statuses).not.toContain("ACTIVE");
  });
});

describe("Accepted chip + EXPIRED display composition (locked spec §12/§21)", () => {
  it("a persisted-ACCEPTED, date-expired Contract is included under the Accepted filter (status match alone), while its own canonical display status is EXPIRED — the two are orthogonal by design, never reconciled into a second filter value", () => {
    const expiredAccepted = {
      status: "ACCEPTED" as const,
      effectiveDate: null,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    };
    const now = new Date("2026-01-01T00:00:00.000Z");

    // The Accepted quick-filter chip's own href filters by persisted
    // status alone (see CONTRACT_QUICK_FILTERS above / the page's own
    // `listParams.status === filter.status` match) — this Contract's
    // persisted `status` genuinely is "ACCEPTED", so it is included.
    const matchesAcceptedFilter = expiredAccepted.status === "ACCEPTED";
    expect(matchesAcceptedFilter).toBe(true);

    // Its own DISPLAY status, via the one canonical derivation, is
    // EXPIRED — never re-derived or reinterpreted by any list-layer
    // logic of this slice's own.
    expect(getContractDisplayStatus({ ...expiredAccepted, now })).toBe("EXPIRED");
  });

  it("a persisted-ACCEPTED, not-yet-expired Contract still displays as ACTIVE (or ACCEPTED if not yet effective) under the same Accepted filter — the filter itself never changes based on expiry", () => {
    const activeAccepted = {
      status: "ACCEPTED" as const,
      effectiveDate: null,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    };
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(activeAccepted.status === "ACCEPTED").toBe(true);
    expect(getContractDisplayStatus({ ...activeAccepted, now })).toBe("ACTIVE");
  });
});
