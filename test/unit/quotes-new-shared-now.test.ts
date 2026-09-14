import { describe, it, expect } from "vitest";
import { formatDateOnly, parseDateOnly } from "@/lib/invoices/date-only";
import { addValidityDays } from "@/lib/quote-templates/date";

/**
 * Quote Templates Phase 2, Section G ("one authoritative `now`" — a
 * specific Phase 1 review requirement). src/app/(dashboard)/quotes/new/
 * page.tsx computes exactly ONE `new Date()` per request and reuses it
 * for both the blank Quote's own `issueDate` default (formatDateOnly)
 * and the applied template's own `validUntil` (getQuoteTemplateDefaults
 * -> addValidityDays). This file proves the underlying date-only
 * arithmetic those two call sites share is self-consistent — that
 * `validUntil` always means exactly "issueDate + validityDays UTC
 * calendar days" for the SAME `now` — and, in the last test, makes
 * concrete exactly the off-by-one bug shape that guarantee prevents: two
 * SEPARATELY-evaluated `now` values straddling a UTC midnight rollover
 * disagreeing by one calendar day. Pure, deterministic, no Date.now() —
 * every `now` here is a fixed literal.
 */
describe("quotes/new — shared `now` keeps issueDate and template validUntil consistent", () => {
  it("agrees exactly for a `now` at the very end of a UTC day (23:59:59.999)", () => {
    const now = new Date("2026-01-31T23:59:59.999Z");
    const issueDate = formatDateOnly(now);
    const validUntil = formatDateOnly(addValidityDays(now, 30));
    expect(issueDate).toBe("2026-01-31");

    // Independently re-derive the expected value FROM issueDate itself
    // (never from `now` a second time) — proves validUntil is computed
    // from the exact same calendar date issueDate displays.
    const parsedIssueDate = parseDateOnly(issueDate);
    expect(parsedIssueDate.ok).toBe(true);
    if (!parsedIssueDate.ok) return;
    const expected = new Date(parsedIssueDate.date);
    expected.setUTCDate(expected.getUTCDate() + 30);
    expect(validUntil).toBe(formatDateOnly(expected));
  });

  it("agrees exactly for a `now` at the very start of a UTC day (00:00:00.001), across a month boundary", () => {
    const now = new Date("2026-03-01T00:00:00.001Z");
    const issueDate = formatDateOnly(now);
    const validUntil = formatDateOnly(addValidityDays(now, 1));
    expect(issueDate).toBe("2026-03-01");
    expect(validUntil).toBe("2026-03-02");
  });

  it("agrees exactly across a year boundary and a leap-day February", () => {
    const now = new Date("2028-02-28T12:00:00.000Z"); // 2028 is a leap year
    expect(formatDateOnly(addValidityDays(now, 1))).toBe("2028-02-29");
    expect(formatDateOnly(addValidityDays(now, 2))).toBe("2028-03-01");

    const newYearsEve = new Date("2026-12-31T18:00:00.000Z");
    expect(formatDateOnly(addValidityDays(newYearsEve, 1))).toBe("2027-01-01");
  });

  it("demonstrates the exact off-by-one two SEPARATELY-evaluated `now` values would produce, straddling a UTC midnight rollover — this is precisely what reusing one shared `now` prevents", () => {
    const firstNow = new Date("2026-02-28T23:59:59.999Z");
    const secondNowOneTickLater = new Date("2026-03-01T00:00:00.001Z"); // the next UTC calendar day

    const issueDateFromSharedNow = formatDateOnly(firstNow);
    const validUntilFromTheSameSharedNow = formatDateOnly(addValidityDays(firstNow, 1));
    expect(issueDateFromSharedNow).toBe("2026-02-28");
    expect(validUntilFromTheSameSharedNow).toBe("2026-03-01"); // exactly "issueDate + 1"

    // If validUntil had instead been computed from a second, independently
    // re-evaluated `new Date()` a moment later (the bug this page's
    // single-`now` design rules out by construction), it would land one
    // day further than "issueDate + 1" actually means.
    const validUntilFromADifferentLaterNow = formatDateOnly(addValidityDays(secondNowOneTickLater, 1));
    expect(validUntilFromADifferentLaterNow).toBe("2026-03-02");
    expect(validUntilFromADifferentLaterNow).not.toBe(validUntilFromTheSameSharedNow);
  });
});
