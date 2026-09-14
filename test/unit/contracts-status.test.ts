import { describe, expect, it } from "vitest";
import { ContractStatus } from "@/generated/prisma/enums";
import { isContractExpired, getContractDisplayStatus, isContractEditable, isContractArchived } from "@/lib/contracts/status";

/**
 * Contracts Phase 1 — the derived-status helpers (src/lib/contracts/
 * status.ts) are the single source of truth for ACTIVE/EXPIRED semantics;
 * neither is ever a stored ContractStatus value (see the enum's own test
 * below). Every `now` is explicitly injected — no test relies on the real
 * wall clock.
 */

describe("ContractStatus — canonical stored statuses", () => {
  it("are exactly DRAFT, SENT, ACCEPTED, TERMINATED — no ACTIVE, no EXPIRED, no ARCHIVED", () => {
    expect(Object.values(ContractStatus).sort()).toEqual(["ACCEPTED", "DRAFT", "SENT", "TERMINATED"].sort());
  });
});

describe("isContractExpired", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  it("a DRAFT Contract is never expired, regardless of expiresAt", () => {
    expect(isContractExpired({ status: "DRAFT", expiresAt: new Date("2020-01-01T00:00:00.000Z"), now })).toBe(false);
  });

  it("a SENT Contract is never expired", () => {
    expect(isContractExpired({ status: "SENT", expiresAt: new Date("2020-01-01T00:00:00.000Z"), now })).toBe(false);
  });

  it("a TERMINATED Contract is never (derived-)expired — termination overrides everything", () => {
    expect(isContractExpired({ status: "TERMINATED", expiresAt: new Date("2020-01-01T00:00:00.000Z"), now })).toBe(false);
  });

  it("an ACCEPTED Contract with a null expiresAt is never expired", () => {
    expect(isContractExpired({ status: "ACCEPTED", expiresAt: null, now })).toBe(false);
  });

  it("an ACCEPTED Contract with a future expiresAt is not expired", () => {
    expect(isContractExpired({ status: "ACCEPTED", expiresAt: new Date("2026-07-01T00:00:00.000Z"), now })).toBe(false);
  });

  it("an ACCEPTED Contract with a past expiresAt is expired", () => {
    expect(isContractExpired({ status: "ACCEPTED", expiresAt: new Date("2026-06-01T00:00:00.000Z"), now })).toBe(true);
  });

  it("boundary: NOT expired for any instant strictly before its own expiresAt UTC midnight", () => {
    const expiresAt = new Date("2026-06-15T00:00:00.000Z");
    const justBefore = new Date("2026-06-14T23:59:59.999Z");
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: justBefore })).toBe(false);
  });

  it("boundary: the exact expiresAt UTC-midnight instant itself is NOT yet expired (strict less-than) — expired starts the instant after", () => {
    const expiresAt = new Date("2026-06-15T00:00:00.000Z");
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2026-06-15T00:00:00.000Z") })).toBe(false);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2026-06-15T00:00:00.001Z") })).toBe(true);
  });

  it("boundary: expired for effectively the entirety of its own expiresAt calendar day onward", () => {
    const expiresAt = new Date("2026-06-15T00:00:00.000Z");
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2026-06-15T12:00:00.000Z") })).toBe(true);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2026-06-16T00:00:00.000Z") })).toBe(true);
  });

  it("defaults `now` to the real current time when omitted", () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt: farFuture })).toBe(false);
    const farPast = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt: farPast })).toBe(true);
  });

  // Contracts Hardening §11 -- deterministic date-completeness cases the
  // pre-push review flagged as absent. Pure Date.getTime() arithmetic
  // means neither of these is expected to behave specially, but the
  // review explicitly asked for the cases to be proven, not assumed.
  it("leap-day boundary: Feb 29 of a leap year behaves exactly like any other calendar day", () => {
    const expiresAt = new Date("2028-02-29T00:00:00.000Z"); // 2028 is a leap year
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2028-02-28T23:59:59.999Z") })).toBe(false);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2028-02-29T00:00:00.000Z") })).toBe(false);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2028-02-29T00:00:00.001Z") })).toBe(true);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2028-03-01T00:00:00.000Z") })).toBe(true);
  });

  it("year boundary: Dec 31 -> Jan 1 crossing behaves exactly like any other day crossing", () => {
    const expiresAt = new Date("2026-12-31T00:00:00.000Z");
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2026-12-30T23:59:59.999Z") })).toBe(false);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2026-12-31T00:00:00.000Z") })).toBe(false);
    expect(isContractExpired({ status: "ACCEPTED", expiresAt, now: new Date("2027-01-01T00:00:00.000Z") })).toBe(true);
  });
});

describe("getContractDisplayStatus", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("DRAFT -> DRAFT", () => {
    expect(getContractDisplayStatus({ status: "DRAFT", effectiveDate: null, expiresAt: null, now })).toBe("DRAFT");
  });

  it("SENT -> SENT", () => {
    expect(getContractDisplayStatus({ status: "SENT", effectiveDate: null, expiresAt: null, now })).toBe("SENT");
  });

  it("ACCEPTED with no effectiveDate -> ACTIVE", () => {
    expect(getContractDisplayStatus({ status: "ACCEPTED", effectiveDate: null, expiresAt: null, now })).toBe("ACTIVE");
  });

  it("ACCEPTED with a future effectiveDate -> ACCEPTED (not yet in effect)", () => {
    const effectiveDate = new Date("2026-07-01T00:00:00.000Z");
    expect(getContractDisplayStatus({ status: "ACCEPTED", effectiveDate, expiresAt: null, now })).toBe("ACCEPTED");
  });

  it("ACCEPTED with a past effectiveDate -> ACTIVE", () => {
    const effectiveDate = new Date("2026-01-01T00:00:00.000Z");
    expect(getContractDisplayStatus({ status: "ACCEPTED", effectiveDate, expiresAt: null, now })).toBe("ACTIVE");
  });

  it("ACCEPTED with an effectiveDate exactly equal to now -> ACTIVE (not strictly future)", () => {
    expect(getContractDisplayStatus({ status: "ACCEPTED", effectiveDate: now, expiresAt: null, now })).toBe("ACTIVE");
  });

  it("ACCEPTED, past effectiveDate, past expiresAt -> EXPIRED", () => {
    const effectiveDate = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-06-01T00:00:00.000Z");
    expect(getContractDisplayStatus({ status: "ACCEPTED", effectiveDate, expiresAt, now })).toBe("EXPIRED");
  });

  it("TERMINATED always wins over any derived ACTIVE/EXPIRED reading", () => {
    const effectiveDate = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-15T00:00:00.000Z"); // long expired
    expect(getContractDisplayStatus({ status: "TERMINATED", effectiveDate, expiresAt, now })).toBe("TERMINATED");
  });

  // Contracts Hardening §11 -- date-completeness cases through the full
  // derivation function, not just isContractExpired in isolation.
  it("leap-day boundary: expiresAt on Feb 29 of a leap year -> EXPIRED starts the instant after, not the day after", () => {
    const leapNow = new Date("2028-02-29T00:00:00.001Z");
    expect(
      getContractDisplayStatus({ status: "ACCEPTED", effectiveDate: null, expiresAt: new Date("2028-02-29T00:00:00.000Z"), now: leapNow }),
    ).toBe("EXPIRED");
  });

  it("year boundary: an ACCEPTED Contract effective exactly at the new year is ACTIVE, not still ACCEPTED", () => {
    const newYear = new Date("2027-01-01T00:00:00.000Z");
    expect(getContractDisplayStatus({ status: "ACCEPTED", effectiveDate: newYear, expiresAt: null, now: newYear })).toBe("ACTIVE");
  });
});

describe("isContractEditable", () => {
  it("DRAFT is editable", () => {
    expect(isContractEditable("DRAFT")).toBe(true);
  });

  it("SENT/ACCEPTED/TERMINATED are never editable", () => {
    expect(isContractEditable("SENT")).toBe(false);
    expect(isContractEditable("ACCEPTED")).toBe(false);
    expect(isContractEditable("TERMINATED")).toBe(false);
  });
});

describe("isContractArchived — orthogonal to status", () => {
  it("null archivedAt means not archived", () => {
    expect(isContractArchived(null)).toBe(false);
  });

  it("a non-null archivedAt means archived, regardless of what status independently is", () => {
    expect(isContractArchived(new Date())).toBe(true);
  });
});
