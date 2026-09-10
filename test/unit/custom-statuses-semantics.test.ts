import { describe, expect, it } from "vitest";
import {
  isSystemClientStatus,
  isSystemLeadStatus,
  isSystemProjectStatus,
  resolveLeadIsWon,
  resolveLeadIsLost,
  resolveClientIsActive,
  resolveProjectIsInProgress,
} from "@/lib/custom-statuses/semantics";

/**
 * Custom Statuses Phase 2A (Section E/F/I/J) — test items 11, 12, 25 of
 * the originating task's own Section W (plus the underlying
 * isSystem*Status identity helpers those build on). Proves every real
 * business semantic (Lead WON/LOST, Client ACTIVE, Project IN_PROGRESS)
 * is decided by immutable system identity — isSystem + entityType + key
 * — never by a mutable label, and never satisfied by a custom
 * definition no matter how its label or legacy compatibility value reads.
 */

const systemLeadWon = { isSystem: true, entityType: "LEAD" as const, key: "won" };
const systemLeadLost = { isSystem: true, entityType: "LEAD" as const, key: "lost" };
const systemClientActive = { isSystem: true, entityType: "CLIENT" as const, key: "active" };
const systemProjectInProgress = { isSystem: true, entityType: "PROJECT" as const, key: "in_progress" };

// A custom definition whose own key/label are deliberately chosen to
// resemble a system one — the whole point of this suite is proving this
// never satisfies any real semantic check.
const customLookAlikeWon = { isSystem: false, entityType: "LEAD" as const, key: "won" };
const customLabelResemblingActive = { isSystem: false, entityType: "CLIENT" as const, key: "vip_active" };

describe("Custom Statuses Phase 2A — system semantic identity (Section E)", () => {
  it("isSystemLeadStatus/isSystemClientStatus/isSystemProjectStatus require isSystem true AND the matching entityType AND the matching key — all three, never fewer", () => {
    expect(isSystemLeadStatus(systemLeadWon, "won")).toBe(true);
    expect(isSystemLeadStatus(systemLeadWon, "lost")).toBe(false);
    expect(isSystemLeadStatus(customLookAlikeWon, "won")).toBe(false); // isSystem false
    expect(isSystemClientStatus(systemLeadWon as never, "won")).toBe(false); // wrong entityType (LEAD, asked as CLIENT)
    expect(isSystemClientStatus(systemClientActive, "active")).toBe(true);
    expect(isSystemProjectStatus(systemProjectInProgress, "in_progress")).toBe(true);
  });

  it("null/undefined definition never satisfies any system check", () => {
    expect(isSystemLeadStatus(null, "won")).toBe(false);
    expect(isSystemLeadStatus(undefined, "won")).toBe(false);
  });
});

describe("Custom Statuses Phase 2A — Lead WON/LOST (Section F, test items 11-14)", () => {
  it("11. resolveLeadIsWon: a custom Lead status — even one whose own key/label is literally 'won' — never satisfies WON, only the real system WON definition does", () => {
    expect(resolveLeadIsWon({ stage: "WON", statusDefinition: systemLeadWon })).toBe(true);
    expect(resolveLeadIsWon({ stage: "WON", statusDefinition: customLookAlikeWon })).toBe(false);
    expect(resolveLeadIsWon({ stage: "NEW", statusDefinition: systemLeadWon })).toBe(true); // definition wins over stale legacy stage
  });

  it("12. resolveLeadIsLost: same guarantee for LOST", () => {
    expect(resolveLeadIsLost({ stage: "LOST", statusDefinition: systemLeadLost })).toBe(true);
    const customLookAlikeLost = { isSystem: false, entityType: "LEAD" as const, key: "lost" };
    expect(resolveLeadIsLost({ stage: "LOST", statusDefinition: customLookAlikeLost })).toBe(false);
  });

  it("13/14. system WON/LOST semantics are preserved exactly — a real system definition with the matching key always resolves true, matching this app's own pre-Phase-2A behavior", () => {
    expect(resolveLeadIsWon({ stage: "WON", statusDefinition: systemLeadWon })).toBe(true);
    expect(resolveLeadIsLost({ stage: "LOST", statusDefinition: systemLeadLost })).toBe(true);
  });

  it("Section D fallback: a null statusDefinition (historical/unbackfilled row) falls back to the legacy `stage` enum directly", () => {
    expect(resolveLeadIsWon({ stage: "WON", statusDefinition: null })).toBe(true);
    expect(resolveLeadIsWon({ stage: "NEW", statusDefinition: null })).toBe(false);
    expect(resolveLeadIsLost({ stage: "LOST", statusDefinition: undefined })).toBe(true);
  });
});

describe("Custom Statuses Phase 2A — Client ACTIVE (Section I, test item 25)", () => {
  it("25. a custom Client status never inherits ACTIVE semantics, even with a label resembling 'active' or a stale legacy ACTIVE value", () => {
    expect(resolveClientIsActive({ status: "ACTIVE", statusDefinition: customLabelResemblingActive })).toBe(false);
    expect(resolveClientIsActive({ status: "ACTIVE", statusDefinition: systemClientActive })).toBe(true);
  });

  it("26. system ACTIVE behavior is preserved — the real system ACTIVE definition always resolves true regardless of the legacy value (definition-authoritative)", () => {
    expect(resolveClientIsActive({ status: "LEAD", statusDefinition: systemClientActive })).toBe(true);
  });

  it("Section D fallback for Client", () => {
    expect(resolveClientIsActive({ status: "ACTIVE", statusDefinition: null })).toBe(true);
    expect(resolveClientIsActive({ status: "LEAD", statusDefinition: null })).toBe(false);
  });
});

describe("Custom Statuses Phase 2A — Project IN_PROGRESS (Section J, test items 21-22 row-level form)", () => {
  it("a custom Project status never inherits IN_PROGRESS semantics, even with a stale legacy IN_PROGRESS compatibility value", () => {
    const customInProgressLookAlike = { isSystem: false, entityType: "PROJECT" as const, key: "urgent" };
    expect(resolveProjectIsInProgress({ status: "IN_PROGRESS", statusDefinition: customInProgressLookAlike })).toBe(false);
    expect(resolveProjectIsInProgress({ status: "IN_PROGRESS", statusDefinition: systemProjectInProgress })).toBe(true);
  });

  it("Section D fallback for Project", () => {
    expect(resolveProjectIsInProgress({ status: "IN_PROGRESS", statusDefinition: null })).toBe(true);
    expect(resolveProjectIsInProgress({ status: "PLANNING", statusDefinition: null })).toBe(false);
  });
});
