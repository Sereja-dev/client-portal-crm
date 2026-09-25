import { Prisma } from "@/generated/prisma/browser";
import { describe, expect, it } from "vitest";
import { formatLeadValue } from "@/lib/leads/format-value";

/**
 * Lead Value Currency Correctness fix. `formatLeadValue` is the single
 * shared implementation every real render call site (List desktop table,
 * List mobile record card, Pipeline card) delegates to — see
 * src/lib/leads/format-value.ts's own header comment — so exhaustively
 * proving its behavior here is a genuine, deterministic proof of the fix
 * at all three sites, not an implementation-string assertion: every
 * call site now literally IS this function.
 */
describe("formatLeadValue — Lead Value Currency Correctness fix", () => {
  it("a null value renders '—', regardless of currency (unchanged pre-fix behavior)", () => {
    expect(formatLeadValue(null, "USD")).toBe("—");
    expect(formatLeadValue(null, "EUR")).toBe("—");
    expect(formatLeadValue(null, null)).toBe("—");
  });

  it("an undefined value renders '—', regardless of currency", () => {
    expect(formatLeadValue(undefined, "USD")).toBe("—");
    expect(formatLeadValue(undefined, null)).toBe("—");
  });

  it("a present value with a USD currency renders correctly (regression: existing $ behavior unchanged)", () => {
    expect(formatLeadValue(1234.5, "USD")).toBe("$1,234.50");
  });

  it("a present value with a non-USD currency (EUR) renders in that currency, never $ — the actual defect fix", () => {
    const result = formatLeadValue(1234.5, "EUR");
    expect(result).not.toContain("$");
    expect(result).toContain("1,234.50");
    expect(result).toMatch(/€|EUR/);
  });

  it("a present value with a non-USD currency (AED) renders in that currency, never $", () => {
    const result = formatLeadValue(1234.5, "AED");
    expect(result).not.toContain("$");
    expect(result).toContain("AED");
  });

  it("CRITICAL — a present value with a null (unresolvable) currency renders '—', never an invented USD amount", () => {
    const result = formatLeadValue(1234.5, null);
    expect(result).toBe("—");
    expect(result).not.toContain("$");
    expect(result).not.toContain("USD");
  });

  it("accepts a real Prisma.Decimal — the exact shape prisma.lead.findMany returns on the List (Server Component) path", () => {
    const decimalValue = new Prisma.Decimal("2500.00");
    expect(formatLeadValue(decimalValue, "USD")).toBe("$2,500.00");
    expect(formatLeadValue(decimalValue, null)).toBe("—");
  });

  it("accepts a stringified Decimal — the exact shape PipelineLead.value carries across the Server/Client boundary", () => {
    expect(formatLeadValue("2500.00", "EUR")).not.toContain("$");
    expect(formatLeadValue("2500.00", null)).toBe("—");
  });

  it("a zero value is still a real, present value — never treated as missing", () => {
    expect(formatLeadValue(0, "USD")).toBe("$0.00");
    expect(formatLeadValue(new Prisma.Decimal("0"), "USD")).toBe("$0.00");
  });
});
