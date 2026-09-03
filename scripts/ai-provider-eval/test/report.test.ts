import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildArtifactRow, buildReproducibilityMetadata, writeReport } from "../report.js";
import { OPENAI_REASONING_EFFORT } from "../openai-compat.js";
import { scoreRun } from "../scoring.js";
import type { BenchmarkCase } from "../cases.js";
import type { RunResult } from "../result-types.js";
import type { ProviderAggregate } from "../decision.js";

const caseDef: BenchmarkCase = {
  id: "test-case",
  category: "client-search",
  prompt: "test",
  expectedToolSequence: ["searchClients"],
  maxToolCalls: 1,
  expectedFactGroups: [],
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

describe("report.ts — buildReproducibilityMetadata includes a live pricing-freshness read", () => {
  test("pricingFreshnessWarning is present as a field (null today, since the committed pricing snapshot is current)", () => {
    const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true });
    assert.ok("pricingFreshnessWarning" in metadata);
    // Not asserting null vs non-null here — asserting the field exists
    // and is wired to the real getPricingFreshnessWarning() (see
    // test/pricing-freshness.test.ts for that function's own behavior
    // in isolation); this test's job is only to prove report.ts
    // actually calls it, not to re-test its threshold logic.
  });
});

describe("report.ts — OpenAI reasoning_effort compatibility parameter is captured, never hidden", () => {
  test("buildReproducibilityMetadata records openaiReasoningEffort = 'none', sourced from openai-compat.ts", () => {
    const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true });
    assert.equal(metadata.openaiReasoningEffort, OPENAI_REASONING_EFFORT);
    assert.equal(metadata.openaiReasoningEffort, "none");
  });

  test("there is no Anthropic-side reasoning/thinking metadata field — the Anthropic request is unchanged", () => {
    const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true }) as Record<string, unknown>;
    for (const key of Object.keys(metadata)) {
      assert.equal(/anthropic.*(reasoning|thinking)/i.test(key), false, `unexpected Anthropic reasoning/thinking key: ${key}`);
    }
  });

  test("report.md states the OpenAI reasoning_effort value explicitly in the human-readable Models section (not only the buried JSON dump)", () => {
    const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true });
    // Isolated per-test scratch directory — never the real, official
    // RESULTS_DIR. See test/results-dir-safety.test.ts for the regression
    // proving this test suite cannot touch official benchmark artifacts.
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-report-test-"));
    try {
      const written = writeReport({
        rows: [], metadata,
        anthropic: { provider: "anthropic", totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100, uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0, medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100 },
        openai: { provider: "openai", totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100, uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0, medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100 },
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir);
      const md = readFileSync(written.markdownPath, "utf8");
      const modelsSectionIndex = md.indexOf("## Models");
      const jsonDumpIndex = md.indexOf("```json");
      assert.ok(modelsSectionIndex >= 0 && modelsSectionIndex < jsonDumpIndex);
      const modelsSection = md.slice(modelsSectionIndex, jsonDumpIndex);
      assert.match(modelsSection, /reasoning_effort: "none"/);
    } finally {
      // Scoped to exactly the mkdtempSync-returned path — never RESULTS_DIR.
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("report.ts — Markdown STALE_PRICING_WARNING banner (Finding 4)", () => {
  function perfectAgg(provider: "anthropic" | "openai"): ProviderAggregate {
    return {
      provider, totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100,
      uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0,
      medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100,
    };
  }

  test("a non-null pricingFreshnessWarning is surfaced prominently in report.md, never buried", () => {
    const metadata = {
      gitSha: "test", benchmarkDefinitionVersion: "1.1.0-test", benchmarkTimestamp: "t", caseFileHash: "h", toolContractSnapshotHash: "h",
      systemPromptHash: "h", anthropicModelId: "m", openaiModelId: "m", openaiReasoningEffort: "none", pricingSnapshotDate: "2020-01-01",
      pricesUsed: {} as ReturnType<typeof buildReproducibilityMetadata>["pricesUsed"], repetitionCount: 3,
      maxOutputTokens: 1, maxToolCallsPerTurn: 1, maxProviderCallsPerTurn: 1,
      samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)" as const,
      anthropicSdkVersion: "x", openaiSdkVersion: "x", officialRun: true,
      pricingFreshnessWarning: "Pricing/model metadata is 9999 days old and must be manually reverified.",
    };
    const tempDir1 = mkdtempSync(join(tmpdir(), "aqenra-report-test-"));
    try {
      const written = writeReport({
        rows: [], metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"),
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir1);
      const md = readFileSync(written.markdownPath, "utf8");
      assert.match(md, /STALE_PRICING_WARNING/);
      assert.match(md, /9999 days old/);
      // Prominent means near the top, not only inside the buried JSON reproducibility dump at the bottom.
      const bannerIndex = md.indexOf("STALE_PRICING_WARNING");
      const jsonDumpIndex = md.indexOf("```json");
      assert.ok(bannerIndex < jsonDumpIndex, "banner must appear before the buried JSON metadata dump");
    } finally {
      rmSync(tempDir1, { recursive: true, force: true });
    }
  });

  test("a null pricingFreshnessWarning produces no banner at all", () => {
    const metadata = {
      gitSha: "test", benchmarkDefinitionVersion: "1.1.0-test", benchmarkTimestamp: "t", caseFileHash: "h", toolContractSnapshotHash: "h",
      systemPromptHash: "h", anthropicModelId: "m", openaiModelId: "m", openaiReasoningEffort: "none", pricingSnapshotDate: "2026-09-03",
      pricesUsed: {} as ReturnType<typeof buildReproducibilityMetadata>["pricesUsed"], repetitionCount: 3,
      maxOutputTokens: 1, maxToolCallsPerTurn: 1, maxProviderCallsPerTurn: 1,
      samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)" as const,
      anthropicSdkVersion: "x", openaiSdkVersion: "x", officialRun: true, pricingFreshnessWarning: null,
    };
    const tempDir2 = mkdtempSync(join(tmpdir(), "aqenra-report-test-"));
    try {
      const written = writeReport({
        rows: [], metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"),
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir2);
      const md = readFileSync(written.markdownPath, "utf8");
      assert.equal(md.includes("STALE_PRICING_WARNING"), false);
    } finally {
      rmSync(tempDir2, { recursive: true, force: true });
    }
  });

  test("the drafting-packet reference in report.md names a real, always-generated path — never a dangling promise", () => {
    const metadata = {
      gitSha: "test", benchmarkDefinitionVersion: "1.1.0-test", benchmarkTimestamp: "t", caseFileHash: "h", toolContractSnapshotHash: "h",
      systemPromptHash: "h", anthropicModelId: "m", openaiModelId: "m", openaiReasoningEffort: "none", pricingSnapshotDate: "2026-09-03",
      pricesUsed: {} as ReturnType<typeof buildReproducibilityMetadata>["pricesUsed"], repetitionCount: 3,
      maxOutputTokens: 1, maxToolCallsPerTurn: 1, maxProviderCallsPerTurn: 1,
      samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)" as const,
      anthropicSdkVersion: "x", openaiSdkVersion: "x", officialRun: true, pricingFreshnessWarning: null,
    };
    const tempDir3 = mkdtempSync(join(tmpdir(), "aqenra-report-test-"));
    try {
      const written = writeReport({
        rows: [], metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"),
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir3);
      const md = readFileSync(written.markdownPath, "utf8");
      assert.match(md, /results\/drafting-blind-packet\.json/);
      assert.match(md, /generated automatically/);
    } finally {
      rmSync(tempDir3, { recursive: true, force: true });
    }
  });
});
