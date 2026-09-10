import { describe, expect, it } from "vitest";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";

/**
 * Custom Statuses Phase 2A (Section C/D/P) — test items 1-6 of the
 * originating task's own Section W. Proves resolveStatusPresentation is
 * the one authoritative "what does this entity's status badge show"
 * resolver: definition label/color win when present, legacy enum only
 * ever supplies a fallback.
 */

describe("resolveStatusPresentation — Custom Statuses Phase 2A read/display", () => {
  it("1/2/3. a real definition's own label is used verbatim, regardless of what the legacy enum value is (Client/Lead/Project all share this one resolver)", () => {
    const result = resolveStatusPresentation({ label: "VIP", color: "SUCCESS" }, "ACTIVE");
    expect(result.label).toBe("VIP");
  });

  it("4. definition.color maps to the matching StatusBadge tone", () => {
    expect(resolveStatusPresentation({ label: "X", color: "DANGER" }, "ACTIVE").tone).toBe("danger");
    expect(resolveStatusPresentation({ label: "X", color: "SUCCESS" }, "ACTIVE").tone).toBe("success");
    expect(resolveStatusPresentation({ label: "X", color: "WARNING" }, "ACTIVE").tone).toBe("warning");
    expect(resolveStatusPresentation({ label: "X", color: "INFO" }, "ACTIVE").tone).toBe("info");
    expect(resolveStatusPresentation({ label: "X", color: "MUTED" }, "ACTIVE").tone).toBe("muted");
    expect(resolveStatusPresentation({ label: "X", color: "NEUTRAL" }, "ACTIVE").tone).toBe("neutral");
  });

  it("5. a null definitionId (definition undefined/null) falls back to the legacy enum — formatStatusLabel + STATUS_TONES, exactly the pre-Phase-1 behavior", () => {
    const withNull = resolveStatusPresentation(null, "IN_PROGRESS");
    const withUndefined = resolveStatusPresentation(undefined, "IN_PROGRESS");
    expect(withNull).toEqual({ label: "In Progress", tone: "info" });
    expect(withUndefined).toEqual({ label: "In Progress", tone: "info" });
  });

  it("6. a real definition overrides a stale/mismatched legacy value entirely — the definition always wins, never blended with the legacy value", () => {
    // A custom definition whose own legacy compatibility value would map
    // to a completely different tone/label if read directly — proves
    // the definition's own label/color are used exclusively.
    const result = resolveStatusPresentation({ label: "Priority Follow-up", color: "WARNING" }, "LOST");
    expect(result).toEqual({ label: "Priority Follow-up", tone: "warning" });
  });

  it("a definition with no color falls back to the legacy value's own STATUS_TONES entry, not to a hardcoded 'neutral'", () => {
    const result = resolveStatusPresentation({ label: "Custom Won-ish", color: null }, "WON");
    expect(result.label).toBe("Custom Won-ish");
    expect(result.tone).toBe("success"); // WON's own STATUS_TONES entry
  });

  it("a definition with no color AND a legacy value with no known tone falls back to 'neutral'", () => {
    const result = resolveStatusPresentation({ label: "Mystery", color: null }, "SOME_UNKNOWN_VALUE");
    expect(result.tone).toBe("neutral");
  });
});
