import { describe, expect, it } from "vitest";
import { computeNextQuoteNumberSuggestion } from "@/lib/quotes/numbering";

/**
 * Quotes / Estimates Phase 1 — the pure half of the numbering helper
 * (see src/lib/quotes/numbering.ts's own header comment). The DB-touching
 * half (suggestNextQuoteNumber) is covered separately in
 * test/integration/quotes/numbering.test.ts, since it needs a real
 * database.
 */

describe("computeNextQuoteNumberSuggestion", () => {
  it("15. an empty organization (no existing numbers) suggests Q-0001", () => {
    expect(computeNextQuoteNumberSuggestion([])).toBe("Q-0001");
  });

  it("16. the next conventional Q-number increments from the highest existing one", () => {
    expect(computeNextQuoteNumberSuggestion(["Q-0001"])).toBe("Q-0002");
    expect(computeNextQuoteNumberSuggestion(["Q-0001", "Q-0002", "Q-0003"])).toBe("Q-0004");
    // Order in the input array doesn't matter — the true numeric max wins.
    expect(computeNextQuoteNumberSuggestion(["Q-0003", "Q-0001", "Q-0002"])).toBe("Q-0004");
  });

  it("increments past 4 digits without truncating (e.g. Q-9999 -> Q-10000)", () => {
    expect(computeNextQuoteNumberSuggestion(["Q-9999"])).toBe("Q-10000");
  });

  it("17. unrelated/manual numbers never break or influence the suggestion", () => {
    expect(computeNextQuoteNumberSuggestion(["INV-2024-05", "Random Reference 123", "Q-0002", "quote-3", "Q-2"])).toBe(
      // "Q-2" matches the pattern too (any digit run) and parses as 2 —
      // same numeric value as "Q-0002", so the max is still 2.
      "Q-0003",
    );
    // Nothing matching Q-<digits> at all -> falls back to Q-0001, exactly
    // like an empty organization would.
    expect(computeNextQuoteNumberSuggestion(["INV-001", "Manual Ref A"])).toBe("Q-0001");
  });

  it("18. the helper is only advisory — calling it repeatedly with the same input always returns the same suggestion (it never reserves or allocates anything)", () => {
    const existing = ["Q-0001", "Q-0002"];
    const first = computeNextQuoteNumberSuggestion(existing);
    const second = computeNextQuoteNumberSuggestion(existing);
    expect(first).toBe(second);
    expect(first).toBe("Q-0003");
    // The input array itself is never mutated.
    expect(existing).toEqual(["Q-0001", "Q-0002"]);
  });
});
