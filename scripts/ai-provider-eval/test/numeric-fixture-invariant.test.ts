/**
 * Proves fixtures/organization.ts's OUTSTANDING_AMOUNT/PAID_REVENUE (the
 * numeric values cases.ts's org-summary-02 asserts against) are the
 * EXACT SAME values the real getOrganizationSummary tool returns at run
 * time — a single source of truth, so the case expectation and the
 * synthetic tool's own output can never silently drift apart (see
 * fixtures/organization.ts's own doc comment and tool-runtime.ts's own
 * executeGetOrganizationSummary, which imports these same constants
 * rather than recomputing them locally).
 *
 * AI Benchmark Mixed-Currency Paid Revenue fix (v1.13.0) — this file's
 * own independent re-derivation below now applies the exact same
 * FINANCIAL_SUMMARY_CURRENCY scoping the fixture itself uses, so this
 * remains a genuine second, independent proof from the raw INVOICES
 * array (never a constant compared to itself) that both aggregates are
 * correctly currency-scoped, plus two explicit literal-value assertions
 * pinning the corrected numbers so a future accidental regression back
 * to a cross-currency sum fails loudly rather than silently matching a
 * newly-wrong "expected" value computed the same broken way.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OUTSTANDING_AMOUNT, PAID_REVENUE, FINANCIAL_SUMMARY_CURRENCY, INVOICES } from "../fixtures/organization.js";
import { BENCHMARK_CASES } from "../cases.js";
import { getBenchmarkToolByName } from "../tool-runtime.js";

describe("fixtures/organization.ts — OUTSTANDING_AMOUNT/PAID_REVENUE numeric single-source-of-truth", () => {
  test("both constants are finite, deterministic numbers", () => {
    assert.equal(Number.isFinite(OUTSTANDING_AMOUNT), true);
    assert.equal(Number.isFinite(PAID_REVENUE), true);
  });

  test("the fixture's canonical financial currency is USD", () => {
    assert.equal(FINANCIAL_SUMMARY_CURRENCY, "USD");
  });

  test("OUTSTANDING_AMOUNT independently equals the sum of SENT+OVERDUE invoice amounts in the fixture's own canonical currency only", () => {
    const expected = INVOICES.filter(
      (i) => (i.status === "SENT" || i.status === "OVERDUE") && i.currency === FINANCIAL_SUMMARY_CURRENCY,
    ).reduce((sum, i) => sum + i.amount, 0);
    assert.equal(OUTSTANDING_AMOUNT, expected);
  });

  test("PAID_REVENUE independently equals the sum of PAID invoice amounts in the fixture's own canonical currency only", () => {
    const expected = INVOICES.filter((i) => i.status === "PAID" && i.currency === FINANCIAL_SUMMARY_CURRENCY).reduce(
      (sum, i) => sum + i.amount,
      0,
    );
    assert.equal(PAID_REVENUE, expected);
  });

  test("PAID_REVENUE is exactly 8400 (USD PAID invoices INV-1001 + INV-1010 only — INV-1007's 9800 EUR is excluded, never blended)", () => {
    assert.equal(PAID_REVENUE, 8400);
  });

  test("OUTSTANDING_AMOUNT is exactly 24250.5 (every SENT/OVERDUE invoice in this fixture already happens to be USD)", () => {
    assert.equal(OUTSTANDING_AMOUNT, 24250.5);
  });

  test("a non-canonical-currency PAID invoice never contributes to PAID_REVENUE — INV-1007's own 9800 EUR is independently confirmed excluded", () => {
    const eurPaidInvoice = INVOICES.find((i) => i.invoiceNumber === "INV-1007");
    assert.equal(eurPaidInvoice?.status, "PAID");
    assert.equal(eurPaidInvoice?.currency, "EUR");
    assert.notEqual(eurPaidInvoice?.currency, FINANCIAL_SUMMARY_CURRENCY);
    // The old, invalid, pre-fix blended value (8400 correct + this EUR
    // row's own 9800 = 18200) is genuinely gone — PAID_REVENUE must never
    // equal it, confirming the EUR row was actually filtered out rather
    // than coincidentally summing to the same total.
    assert.notEqual(PAID_REVENUE, 18200);
    assert.equal(PAID_REVENUE, 8400);
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
