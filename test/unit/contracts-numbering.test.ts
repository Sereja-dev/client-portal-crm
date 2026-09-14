import { describe, expect, it } from "vitest";
import { computeNextContractNumberSuggestion, CONTRACT_NUMBER_PREFIX } from "@/lib/contracts/numbering";

/**
 * Contracts Phase 1 — computeNextContractNumberSuggestion is a plain,
 * advisory-only suggestion; the real race-safety mechanism is the
 * `@@unique([organizationId, contractNumber])` DB constraint, exercised
 * separately in the integration suite. Mirrors
 * test/unit/quote-templates-*.test.ts's own pure-function testing style.
 */

describe("computeNextContractNumberSuggestion", () => {
  it("suggests C-0001 for an empty organization", () => {
    expect(computeNextContractNumberSuggestion([])).toBe("C-0001");
  });

  it("suggests the next number after the highest existing C-#### value", () => {
    expect(computeNextContractNumberSuggestion(["C-0001", "C-0002", "C-0005"])).toBe("C-0006");
  });

  it("pads to 4 digits, growing naturally beyond it", () => {
    expect(computeNextContractNumberSuggestion(["C-0009"])).toBe("C-0010");
    expect(computeNextContractNumberSuggestion(["C-9999"])).toBe("C-10000");
  });

  it("ignores values that don't match the exact C-<digits> shape — manual/legacy/imported numbers never influence the suggestion", () => {
    expect(computeNextContractNumberSuggestion(["2026-CTR-01", "Agreement #3", "C-0002x", "c-0009"])).toBe("C-0001");
  });

  it("ignores whitespace-padded values by trimming before matching", () => {
    expect(computeNextContractNumberSuggestion(["  C-0003  "])).toBe("C-0004");
  });

  it("exposes the exact prefix used", () => {
    expect(CONTRACT_NUMBER_PREFIX).toBe("C-");
  });
});
