/**
 * Proves fixtures/organization.ts's OUTSTANDING_AMOUNT/PAID_REVENUE (the
 * numeric values cases.ts's org-summary-02 asserts against) are the
 * EXACT SAME values the real getOrganizationSummary tool returns at run
 * time — a single source of truth, so the case expectation and the
 * synthetic tool's own output can never silently drift apart (see
 * fixtures/organization.ts's own doc comment and tool-runtime.ts's own
 * executeGetOrganizationSummary, which imports these same constants
 * rather than recomputing them locally).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OUTSTANDING_AMOUNT, PAID_REVENUE, INVOICES } from "../fixtures/organization.js";
import { BENCHMARK_CASES } from "../cases.js";
import { getBenchmarkToolByName } from "../tool-runtime.js";

describe("fixtures/organization.ts — OUTSTANDING_AMOUNT/PAID_REVENUE numeric single-source-of-truth", () => {
  test("both constants are finite, deterministic numbers", () => {
    assert.equal(Number.isFinite(OUTSTANDING_AMOUNT), true);
    assert.equal(Number.isFinite(PAID_REVENUE), true);
  });

  test("OUTSTANDING_AMOUNT independently equals the sum of SENT+OVERDUE invoice amounts in the fixture", () => {
    const expected = INVOICES.filter((i) => i.status === "SENT" || i.status === "OVERDUE").reduce((sum, i) => sum + i.amount, 0);
    assert.equal(OUTSTANDING_AMOUNT, expected);
  });

  test("PAID_REVENUE independently equals the sum of PAID invoice amounts in the fixture", () => {
    const expected = INVOICES.filter((i) => i.status === "PAID").reduce((sum, i) => sum + i.amount, 0);
    assert.equal(PAID_REVENUE, expected);
  });

  test("the real getOrganizationSummary tool's live output uses these exact same values (zero side effects, offline, no network)", async () => {
    const tool = getBenchmarkToolByName("getOrganizationSummary")!;
    const result = (await tool.execute("test-org-id", {})) as { ok: boolean; outstandingAmount: number; paidRevenue: number };
    assert.equal(result.ok, true);
    assert.equal(result.outstandingAmount, OUTSTANDING_AMOUNT);
    assert.equal(result.paidRevenue, PAID_REVENUE);
  });

  test("org-summary-02's own numeric assertions reference these exact constants, not a second hardcoded copy", () => {
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-02")!;
    const numericValues = caseDef.expectedFactGroups.flatMap((group) => group.filter((a) => a.kind === "numeric").map((a) => (a as { value: number }).value));
    assert.deepEqual(numericValues.sort((a, b) => a - b), [PAID_REVENUE, OUTSTANDING_AMOUNT].sort((a, b) => a - b));
  });
});
