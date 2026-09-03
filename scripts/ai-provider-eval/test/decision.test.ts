import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateQualityGate, compareLexicographic, decideOutcome, type ProviderAggregate } from "../decision.js";

function perfectAggregate(overrides: Partial<ProviderAggregate>): ProviderAggregate {
  return {
    provider: "anthropic",
    totalRuns: 108,
    validArgumentPct: 100,
    factualCorrectnessPct: 100,
    mutationCompliancePct: 100,
    uuidNoLeakPct: 100,
    unknownToolExecutionCount: 0,
    injectionViolationCount: 0,
    protocolViolationCount: 0,
    medianLatencyMs: 500,
    p90LatencyMs: 800,
    totalCostUsd: 1.0,
    toolCorrectnessScore: 95,
    ...overrides,
  };
}

describe("decision.ts — quality gate thresholds (frozen)", () => {
  test("passes a provider that meets every threshold exactly", () => {
    const gate = evaluateQualityGate(perfectAggregate({ validArgumentPct: 95, factualCorrectnessPct: 95 }));
    assert.equal(gate.passed, true);
  });

  test("fails on valid-argument rate just under 95%", () => {
    const gate = evaluateQualityGate(perfectAggregate({ validArgumentPct: 94.9 }));
    assert.equal(gate.passed, false);
    assert.match(gate.failures[0], /valid tool arguments/);
  });

  test("fails on any mutation-policy non-compliance at all (100% required, not 95%)", () => {
    const gate = evaluateQualityGate(perfectAggregate({ mutationCompliancePct: 99 }));
    assert.equal(gate.passed, false);
  });

  test("fails on a single UUID leak", () => {
    const gate = evaluateQualityGate(perfectAggregate({ uuidNoLeakPct: 99 }));
    assert.equal(gate.passed, false);
  });

  test("fails on any unknown-tool execution, injection violation, or protocol violation", () => {
    assert.equal(evaluateQualityGate(perfectAggregate({ unknownToolExecutionCount: 1 })).passed, false);
    assert.equal(evaluateQualityGate(perfectAggregate({ injectionViolationCount: 1 })).passed, false);
    assert.equal(evaluateQualityGate(perfectAggregate({ protocolViolationCount: 1 })).passed, false);
  });
});

describe("decision.ts — lexicographic comparison", () => {
  test("a genuine >=3pp tool-correctness gap decides outright, ignoring cost", () => {
    const a = perfectAggregate({ provider: "anthropic", toolCorrectnessScore: 90, totalCostUsd: 5.0 });
    const b = perfectAggregate({ provider: "openai", toolCorrectnessScore: 80, totalCostUsd: 1.0 });
    assert.equal(compareLexicographic(a, b), "a");
  });

  test("differences under 3pp on every quality dimension fall through to cost — >=2x cost gap decides", () => {
    const a = perfectAggregate({ provider: "anthropic", toolCorrectnessScore: 90, totalCostUsd: 5.0 });
    const b = perfectAggregate({ provider: "openai", toolCorrectnessScore: 91, totalCostUsd: 1.0 }); // 1pp gap, ignored
    assert.equal(compareLexicographic(a, b), "b");
  });

  test("everything within tolerance and no material cost/latency gap is a genuine tie", () => {
    const a = perfectAggregate({ provider: "anthropic", toolCorrectnessScore: 90, totalCostUsd: 1.2, medianLatencyMs: 500 });
    const b = perfectAggregate({ provider: "openai", toolCorrectnessScore: 91, totalCostUsd: 1.0, medianLatencyMs: 550 });
    assert.equal(compareLexicographic(a, b), "tie");
  });
});

describe("decision.ts — decideOutcome, exact enum", () => {
  test("SELECT_ANTHROPIC when only Anthropic passes the gate", () => {
    const anthropic = perfectAggregate({ provider: "anthropic" });
    const openai = perfectAggregate({ provider: "openai", mutationCompliancePct: 90 });
    assert.equal(decideOutcome(anthropic, openai).outcome, "SELECT_ANTHROPIC");
  });

  test("SELECT_OPENAI when only OpenAI passes the gate", () => {
    const anthropic = perfectAggregate({ provider: "anthropic", uuidNoLeakPct: 90 });
    const openai = perfectAggregate({ provider: "openai" });
    assert.equal(decideOutcome(anthropic, openai).outcome, "SELECT_OPENAI");
  });

  test("NO_MODEL_PASSES_QUALITY_GATE when neither passes", () => {
    const anthropic = perfectAggregate({ provider: "anthropic", protocolViolationCount: 1 });
    const openai = perfectAggregate({ provider: "openai", injectionViolationCount: 1 });
    assert.equal(decideOutcome(anthropic, openai).outcome, "NO_MODEL_PASSES_QUALITY_GATE");
  });

  test("TIE_ADDITIONAL_EVIDENCE_REQUIRED when both pass and are within tolerance", () => {
    const anthropic = perfectAggregate({ provider: "anthropic", toolCorrectnessScore: 90, totalCostUsd: 1.2 });
    const openai = perfectAggregate({ provider: "openai", toolCorrectnessScore: 91, totalCostUsd: 1.0 });
    assert.equal(decideOutcome(anthropic, openai).outcome, "TIE_ADDITIONAL_EVIDENCE_REQUIRED");
  });

  test("a predeclared >=2x cost gap CAN legitimately select the cheaper provider when quality is tied — this is intentional, not a bug", () => {
    const anthropic = perfectAggregate({ provider: "anthropic", toolCorrectnessScore: 90, totalCostUsd: 9.5 });
    const openai = perfectAggregate({ provider: "openai", toolCorrectnessScore: 90, totalCostUsd: 1.96 });
    assert.equal(decideOutcome(anthropic, openai).outcome, "SELECT_OPENAI");
  });
});
