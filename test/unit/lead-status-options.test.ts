import { describe, expect, it } from "vitest";
import { buildLeadStatusSelectOptions } from "@/components/leads/lead-status-options";
import type { StatusSelectOption } from "@/lib/custom-statuses/entity-form";

/**
 * Custom Statuses Phase 2B, Section M (CRITICAL) — the one pure function
 * a generic Lead status selector's final option list flows through.
 * Reverified in the Completion Pass (Section F): the system LOST
 * definition must never be offered as a NEW-selection target, only ever
 * as the Lead's own already-current status (the "reactivate out of
 * LOST" case).
 */

function option(overrides: Partial<StatusSelectOption>): StatusSelectOption {
  return {
    id: "id",
    key: "key",
    label: "Label",
    color: null,
    isSystem: false,
    isDefault: false,
    archived: false,
    ...overrides,
  };
}

const NEW = option({ id: "new", key: "new", label: "New", isSystem: true });
const WON = option({ id: "won", key: "won", label: "Won", isSystem: true });
const LOST = option({ id: "lost", key: "lost", label: "Lost", isSystem: true });
const CUSTOM = option({ id: "custom", key: "on_hold", label: "On Hold", isSystem: false });

describe("buildLeadStatusSelectOptions", () => {
  it("excludes system LOST when it is not the Lead's own current status", () => {
    const result = buildLeadStatusSelectOptions([NEW, WON, LOST, CUSTOM], NEW.id);
    expect(result.map((o) => o.id)).toEqual(["new", "won", "custom"]);
  });

  it("keeps system LOST visible when it IS the Lead's own current status (reactivation)", () => {
    const result = buildLeadStatusSelectOptions([NEW, WON, LOST, CUSTOM], LOST.id);
    expect(result.map((o) => o.id)).toEqual(["new", "won", "lost", "custom"]);
  });

  it("system WON is never excluded — it stays a reachable generic target either way", () => {
    const result = buildLeadStatusSelectOptions([NEW, WON, LOST], NEW.id);
    expect(result.map((o) => o.id)).toContain("won");
  });

  it("a CUSTOM option is never excluded — only system LOST is ever filtered", () => {
    const result = buildLeadStatusSelectOptions([NEW, LOST, CUSTOM], NEW.id);
    expect(result.map((o) => o.id)).toContain("custom");
  });

  it("a CUSTOM option whose key happens to be 'lost' (impossible in this app — LOST is a reserved system key, but proven anyway) is never excluded, since only isSystem+key together identify the real LOST", () => {
    const lookalike = option({ id: "lookalike", key: "lost", label: "Lost (custom)", isSystem: false });
    const result = buildLeadStatusSelectOptions([NEW, lookalike], NEW.id);
    expect(result.map((o) => o.id)).toContain("lookalike");
  });
});
