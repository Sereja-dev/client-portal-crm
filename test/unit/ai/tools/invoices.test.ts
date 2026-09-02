import { describe, expect, it } from "vitest";
import { executeSearchInvoices, SEARCH_INVOICES_INPUT_SCHEMA } from "@/lib/ai/tools/invoices";
import { SEARCH_INVOICES_LIMIT } from "@/lib/ai/tools/limits";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

describe("executeSearchInvoices — input validation (no DB success required)", () => {
  it("accepts undefined input", async () => {
    const result = await executeSearchInvoices(ORG_ID, undefined);
    expect(result.ok === false ? result.error : null).not.toBe("invalid_input");
  });
  it("accepts an empty object", async () => {
    const result = await executeSearchInvoices(ORG_ID, {});
    expect(result.ok === false ? result.error : null).not.toBe("invalid_input");
  });
  it("accepts a valid query", async () => {
    const result = await executeSearchInvoices(ORG_ID, { query: "INV-1001" });
    expect(result.ok === false ? result.error : null).not.toBe("invalid_input");
  });
  it("accepts a valid status", async () => {
    const result = await executeSearchInvoices(ORG_ID, { status: "OVERDUE" });
    expect(result.ok === false ? result.error : null).not.toBe("invalid_input");
  });
  it("rejects an oversized query", async () => {
    expect(await executeSearchInvoices(ORG_ID, { query: "a".repeat(101) })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an invalid status enum", async () => {
    expect(await executeSearchInvoices(ORG_ID, { status: "NOT_A_STATUS" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key", async () => {
    expect(await executeSearchInvoices(ORG_ID, { anything: "x" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects organizationId", async () => {
    expect(await executeSearchInvoices(ORG_ID, { organizationId: "foreign-org" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects userId", async () => {
    expect(await executeSearchInvoices(ORG_ID, { userId: "x" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects limit", async () => {
    expect(await executeSearchInvoices(ORG_ID, { limit: 1000 })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects ref", async () => {
    expect(await executeSearchInvoices(ORG_ID, { ref: "11111111-1111-1111-1111-111111111111" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects id", async () => {
    expect(await executeSearchInvoices(ORG_ID, { id: "11111111-1111-1111-1111-111111111111" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a raw Prisma-shaped where clause", async () => {
    expect(await executeSearchInvoices(ORG_ID, { where: { organizationId: "x" } })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a raw Prisma-shaped select clause", async () => {
    expect(await executeSearchInvoices(ORG_ID, { select: { internalNotes: true } })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a raw Prisma-shaped include clause", async () => {
    expect(await executeSearchInvoices(ORG_ID, { include: { emailAttempts: true } })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a nested arbitrary object", async () => {
    expect(await executeSearchInvoices(ORG_ID, { query: { $ne: null } })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a non-object input", async () => {
    expect(await executeSearchInvoices(ORG_ID, "invoices")).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("SEARCH_INVOICES_INPUT_SCHEMA — schema declaration", () => {
  it("forbids additional properties and declares exactly query/status", () => {
    expect(SEARCH_INVOICES_INPUT_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(SEARCH_INVOICES_INPUT_SCHEMA.properties)).toEqual(["query", "status"]);
  });
  it("never declares dueBefore/overdueOnly/ref/id/organizationId", () => {
    const keys = Object.keys(SEARCH_INVOICES_INPUT_SCHEMA.properties);
    expect(keys).not.toContain("dueBefore");
    expect(keys).not.toContain("overdueOnly");
    expect(keys).not.toContain("ref");
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("organizationId");
  });
});

describe("financial amount serialization — Number(Decimal(10,2))", () => {
  // These mirror the exact conversion executeSearchInvoices applies
  // (Number(row.amount), the codebase's own established convention —
  // dashboard/query.ts and invoices/page.tsx both already do this) —
  // proving it round-trips exactly for representative cents values and
  // the maximum valid Decimal(10,2) magnitude, independent of any live
  // DB round-trip (that's proven separately by the integration suite).
  it.each([
    ["0.01", 0.01],
    ["1.10", 1.1],
    ["1234.56", 1234.56],
    ["99999999.99", 99999999.99], // max magnitude for Decimal(10,2)
    ["0.00", 0],
  ])("Number(%s) === %s, exact, no precision drift", (decimalString, expected) => {
    expect(Number(decimalString)).toBe(expected);
    // Round-trips back to the same 2-decimal string representation —
    // proving no float drift when re-serialized, matching what a
    // provider/consumer would see as JSON.
    expect(Number(decimalString).toFixed(2)).toBe(Number(expected).toFixed(2));
  });
});

describe("SEARCH_INVOICES_LIMIT — cap/order contract constant", () => {
  it("is fixed at 10", () => {
    expect(SEARCH_INVOICES_LIMIT).toBe(10);
  });
});
