import { describe, expect, it } from "vitest";
import {
  LEAD_STAGES,
  getLeadStageDefinition,
  isLostLeadStage,
  isTerminalLeadStage,
  isWonLeadStage,
} from "@/lib/leads/stages";
import type { LeadStage } from "@/generated/prisma/enums";

/**
 * Leads / Sales Pipeline Phase 1 (schema foundation only). Every possible
 * LeadStage value, enumerated once here — if a future stage is ever added
 * to the Prisma enum without updating LEAD_STAGES, this file's own
 * ALL_STAGES list intentionally does NOT auto-derive from the enum (there
 * is no runtime reflection over a Prisma-generated TypeScript union), so
 * the "canonical order" test below is the actual guard: it fails loudly
 * if LEAD_STAGES doesn't hold the exact ordered set the product decided
 * on for MVP.
 */
const ALL_STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
const NON_TERMINAL_STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL"];

describe("LEAD_STAGES — canonical order", () => {
  it("is exactly NEW, CONTACTED, QUALIFIED, PROPOSAL, WON, LOST, in that order", () => {
    expect(LEAD_STAGES.map((s) => s.value)).toEqual(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
  });

  it("covers every LeadStage enum value exactly once — no gaps, no duplicates", () => {
    const values = LEAD_STAGES.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.sort()).toEqual([...ALL_STAGES].sort());
  });

  it("each definition's own `order` matches its position in the array", () => {
    LEAD_STAGES.forEach((stage, index) => {
      expect(stage.order).toBe(index);
    });
  });

  it("each definition has a non-empty display label", () => {
    for (const stage of LEAD_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isTerminalLeadStage", () => {
  it("WON is terminal", () => {
    expect(isTerminalLeadStage("WON")).toBe(true);
  });

  it("LOST is terminal", () => {
    expect(isTerminalLeadStage("LOST")).toBe(true);
  });

  it("NEW/CONTACTED/QUALIFIED/PROPOSAL are non-terminal", () => {
    for (const stage of NON_TERMINAL_STAGES) {
      expect(isTerminalLeadStage(stage)).toBe(false);
    }
  });
});

describe("isWonLeadStage", () => {
  it("is true only for WON", () => {
    for (const stage of ALL_STAGES) {
      expect(isWonLeadStage(stage)).toBe(stage === "WON");
    }
  });
});

describe("isLostLeadStage", () => {
  it("is true only for LOST", () => {
    for (const stage of ALL_STAGES) {
      expect(isLostLeadStage(stage)).toBe(stage === "LOST");
    }
  });
});

describe("getLeadStageDefinition", () => {
  it("returns the matching definition for every stage", () => {
    for (const stage of ALL_STAGES) {
      expect(getLeadStageDefinition(stage).value).toBe(stage);
    }
  });
});
