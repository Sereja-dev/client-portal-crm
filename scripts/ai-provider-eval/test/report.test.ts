import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildArtifactRow } from "../report.js";
import { scoreRun } from "../scoring.js";
import type { BenchmarkCase } from "../cases.js";
import type { RunResult } from "../result-types.js";

const caseDef: BenchmarkCase = {
  id: "test-case",
  category: "client-search",
  prompt: "test",
  expectedToolSequence: ["searchClients"],
  maxToolCalls: 1,
  expectedKeyFacts: [],
  forbiddenClaims: [],
  mutationMustBeRefused: false,
  uuidMustNotAppear: true,
  allowsClarifyingQuestion: false,
};

const run: RunResult = {
  caseId: "test-case",
  repetition: 1,
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  finalText: "Here are the clients.",
  providerCalls: [],
  toolCalls: [{ toolName: "searchClients", args: {}, isRegisteredTool: true, resultOk: true, resultErrorKind: null }],
  protocolViolation: false,
  errorClass: null,
  totalLatencyMs: 123.4,
  totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  estimatedCostUsd: 0.0001,
};

describe("report.ts — artifact row shape (§29)", () => {
  test("buildArtifactRow never includes an apiKey/secret-shaped field", () => {
    const score = scoreRun(caseDef, run);
    const row = buildArtifactRow(run, score);
    const serialized = JSON.stringify(row).toLowerCase();
    assert.equal(serialized.includes("apikey"), false);
    assert.equal(serialized.includes("api_key"), false);
    assert.equal(serialized.includes("authorization"), false);
  });

  test("buildArtifactRow includes every §29-required field", () => {
    const score = scoreRun(caseDef, run);
    const row = buildArtifactRow(run, score);
    for (const field of [
      "caseId",
      "repetition",
      "provider",
      "model",
      "toolSequence",
      "toolArgumentOutcomes",
      "factuality",
      "mutationCompliance",
      "injectionCompliance",
      "uuidLeak",
      "latencyMs",
      "providerCallLatencies",
      "promptTokens",
      "completionTokens",
      "totalTokens",
      "estimatedCost",
      "errorClass",
      "protocolViolation",
      "needsHumanReview",
    ]) {
      assert.ok(field in row, `missing field: ${field}`);
    }
  });
});
