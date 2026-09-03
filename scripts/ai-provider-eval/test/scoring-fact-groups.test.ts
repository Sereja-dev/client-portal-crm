/**
 * Benchmark definition v1.1.0 — unit tests for scoring.ts's group/numeric
 * fact-assertion engine (cases.ts's own expectedFactGroups: OR within a
 * group, AND across groups). See cases.ts's own FactAssertion/
 * ExpectedFactGroup doc comments and scoring.ts's own evaluateGroup()
 * doc comment for the exact algorithm being tested here.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreRun } from "../scoring.js";
import { phrase, numeric, eachPhrase } from "../cases.js";
import type { BenchmarkCase } from "../cases.js";
import type { RunResult } from "../result-types.js";

function baseCase(overrides: Partial<BenchmarkCase>): BenchmarkCase {
  return {
    id: "test-case",
    category: "client-search",
    prompt: "test prompt",
    expectedToolSequence: [],
    maxToolCalls: 1,
    expectedFactGroups: [],
    forbiddenClaims: [],
    mutationMustBeRefused: false,
    uuidMustNotAppear: true,
    allowsClarifyingQuestion: false,
    ...overrides,
  };
}

function baseRun(overrides: Partial<RunResult>): RunResult {
  return {
    caseId: "test-case",
    repetition: 1,
    provider: "anthropic",
    model: "test-model",
    finalText: "",
    providerCalls: [],
    toolCalls: [],
    protocolViolation: false,
    errorClass: null,
    totalLatencyMs: 100,
    totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    estimatedCostUsd: 0.001,
    ...overrides,
  };
}

describe("scoring.ts — phrase assertion semantics", () => {
  test("case-insensitive match", () => {
    const caseDef = baseCase({ expectedFactGroups: eachPhrase("Alderbrook Studio") });
    const score = scoreRun(caseDef, baseRun({ finalText: "The client is alderbrook STUDIO, an active account." }));
    assert.deepEqual(score.keyFactsMissing, []);
    assert.deepEqual(score.keyFactsConfirmed, ["Alderbrook Studio"]);
  });

  test("missing phrase", () => {
    const caseDef = baseCase({ expectedFactGroups: eachPhrase("Alderbrook Studio") });
    const score = scoreRun(caseDef, baseRun({ finalText: "No relevant client found." }));
    assert.deepEqual(score.keyFactsMissing, ["Alderbrook Studio"]);
    assert.deepEqual(score.keyFactsConfirmed, []);
  });
});

describe("scoring.ts — OR-within-group / AND-across-groups", () => {
  test("a group passes if ANY assertion in it passes", () => {
    const caseDef = baseCase({ expectedFactGroups: [[phrase("no match"), phrase("not found"), phrase("no client")]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "We have no client by that name." }));
    assert.deepEqual(score.keyFactsMissing, [], "the group must be satisfied by the one phrasing that matched ('no client')");
    assert.deepEqual(score.keyFactsConfirmed, ["no client"]);
  });

  test("a group fails only if NONE of its assertions pass", () => {
    const caseDef = baseCase({ expectedFactGroups: [[phrase("no match"), phrase("not found"), phrase("no client")]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "That client is currently active." }));
    assert.deepEqual(score.keyFactsConfirmed, []);
    assert.deepEqual(score.keyFactsMissing, ["no match / not found / no client"], "a missing multi-option group is described by all its alternatives together");
  });

  test("AND across groups: one group passes, another fails => overall row fails", () => {
    const caseDef = baseCase({
      expectedFactGroups: [[phrase("Alderbrook Studio")], [phrase("Brightline Robotics")]],
    });
    const score = scoreRun(caseDef, baseRun({ finalText: "Active clients include Alderbrook Studio." }));
    assert.deepEqual(score.keyFactsConfirmed, ["Alderbrook Studio"]);
    assert.deepEqual(score.keyFactsMissing, ["Brightline Robotics"]);
  });

  test("AND across groups: all groups pass => overall row passes", () => {
    const caseDef = baseCase({
      expectedFactGroups: [[phrase("Alderbrook Studio")], [phrase("Brightline Robotics")]],
    });
    const score = scoreRun(caseDef, baseRun({ finalText: "Active clients: Alderbrook Studio and Brightline Robotics." }));
    assert.deepEqual(score.keyFactsMissing, []);
    assert.deepEqual(score.keyFactsConfirmed, ["Alderbrook Studio", "Brightline Robotics"]);
  });
});

describe("scoring.ts — numeric assertion semantics", () => {
  test("$24,250.50 in the text passes an assertion for 24250.50", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(24250.5)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "You have $24,250.50 outstanding." }));
    assert.deepEqual(score.keyFactsMissing, []);
  });

  test("bare 24250.50 (no $, no comma) passes", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(24250.5)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "Outstanding: 24250.50" }));
    assert.deepEqual(score.keyFactsMissing, []);
  });

  test("24250.5 (no trailing zero) passes", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(24250.5)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "Outstanding: 24250.5" }));
    assert.deepEqual(score.keyFactsMissing, []);
  });

  test("comma normalization: $1,800.00 passes an assertion for 1800", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(1800)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "One invoice for $1,800.00." }));
    assert.deepEqual(score.keyFactsMissing, []);
  });

  test("cent-tolerance boundary: exactly 0.01 off passes (default toleranceAbs)", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(100)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "Total: 100.01" }));
    assert.deepEqual(score.keyFactsMissing, []);
  });

  test("outside tolerance fails: 0.02 off fails the default 0.01 tolerance", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(100)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "Total: 100.02" }));
    assert.notDeepEqual(score.keyFactsMissing, []);
  });

  test("an unrelated nearby number does not satisfy the assertion", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(24250.5)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "There are 6 clients and $500 paid." }));
    assert.notDeepEqual(score.keyFactsMissing, []);
  });

  test("multiple numbers present, one of which matches, still passes", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(24250.5)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "6 clients, 12 tasks, and $24,250.50 outstanding." }));
    assert.deepEqual(score.keyFactsMissing, []);
  });

  test("no numeric candidate at all fails cleanly (never throws)", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(24250.5)]] });
    const score = scoreRun(caseDef, baseRun({ finalText: "No numbers mentioned here." }));
    assert.deepEqual(score.keyFactsMissing, ["numeric ≈ 24250.5"]);
  });

  test("an explicit non-default toleranceAbs is honored", () => {
    const caseDef = baseCase({ expectedFactGroups: [[numeric(100, 5)]] });
    const scorePass = scoreRun(caseDef, baseRun({ finalText: "Total: 104" }));
    assert.deepEqual(scorePass.keyFactsMissing, []);
    const scoreFail = scoreRun(caseDef, baseRun({ finalText: "Total: 106" }));
    assert.notDeepEqual(scoreFail.keyFactsMissing, []);
  });

  test("a numeric assertion mixed into a group with phrase alternatives — either satisfies the OR", () => {
    const caseDef = baseCase({ expectedFactGroups: [[phrase("outstanding amount"), numeric(24250.5)]] });
    const byNumber = scoreRun(caseDef, baseRun({ finalText: "You have $24,250.50 remaining." }));
    assert.deepEqual(byNumber.keyFactsMissing, []);
    const byPhrase = scoreRun(caseDef, baseRun({ finalText: "The outstanding amount is unclear right now." }));
    assert.deepEqual(byPhrase.keyFactsMissing, []);
  });
});
