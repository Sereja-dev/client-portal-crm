import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCsvCellForSpreadsheet, buildArtifactRow, writeReport, type ReproducibilityMetadata } from "../report.js";
import { scoreRun } from "../scoring.js";
import type { BenchmarkCase } from "../cases.js";
import type { RunResult } from "../result-types.js";
import type { ProviderAggregate } from "../decision.js";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("report.ts — sanitizeCsvCellForSpreadsheet (Finding 3)", () => {
  test("prefixes a leading = with an apostrophe", () => {
    assert.equal(sanitizeCsvCellForSpreadsheet("=SUM(1,1)"), "'=SUM(1,1)");
  });
  test("prefixes a leading + with an apostrophe", () => {
    assert.equal(sanitizeCsvCellForSpreadsheet("+1+1"), "'+1+1");
  });
  test("prefixes a leading - with an apostrophe", () => {
    assert.equal(sanitizeCsvCellForSpreadsheet("-1+1"), "'-1+1");
  });
  test("prefixes a leading @ with an apostrophe", () => {
    assert.equal(sanitizeCsvCellForSpreadsheet("@SUM(1,1)"), "'@SUM(1,1)");
  });
  test("neutralizes a formula marker even behind leading whitespace (conservative spreadsheet safety)", () => {
    assert.equal(sanitizeCsvCellForSpreadsheet("   =SUM(1,1)"), "'   =SUM(1,1)");
    assert.equal(sanitizeCsvCellForSpreadsheet("\t=SUM(1,1)"), "'\t=SUM(1,1)");
  });
  test("leaves an ordinary tool/case/status name completely unchanged", () => {
    for (const safe of ["searchClients", "getOrganizationSummary", "anthropic", "openai", "timeout", ""]) {
      assert.equal(sanitizeCsvCellForSpreadsheet(safe), safe);
    }
  });
  test("does not touch a value where the dangerous character appears mid-string, not leading", () => {
    assert.equal(sanitizeCsvCellForSpreadsheet("value=5"), "value=5");
    assert.equal(sanitizeCsvCellForSpreadsheet("a-b-c"), "a-b-c");
  });
  test("does not double-prefix a value that already starts with an apostrophe", () => {
    // Not classified as dangerous itself (apostrophe isn't one of =+-@),
    // so no prefix is added — content passes through unchanged.
    assert.equal(sanitizeCsvCellForSpreadsheet("'already quoted"), "'already quoted");
  });
});

describe("report.ts — CSV round-trip (sanitization does not break normal escaping)", () => {
  function baseCase(overrides: Partial<BenchmarkCase>): BenchmarkCase {
    return {
      id: "csv-audit", category: "client-search", prompt: "x", expectedToolSequence: ["searchClients"],
      maxToolCalls: 1, expectedFactGroups: [], forbiddenClaims: [], mutationMustBeRefused: false,
      uuidMustNotAppear: true, allowsClarifyingQuestion: false, ...overrides,
    };
  }
  function baseRun(overrides: Partial<RunResult>): RunResult {
    return {
      caseId: "csv-audit", repetition: 1, provider: "anthropic", model: "x", finalText: "ok",
      providerCalls: [], toolCalls: [], protocolViolation: false, errorClass: null,
      totalLatencyMs: 1, totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      estimatedCostUsd: 0, ...overrides,
    };
  }

  function perfectAgg(provider: "anthropic" | "openai"): ProviderAggregate {
    return {
      provider, totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100,
      uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0,
      medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100,
    };
  }

  test("a formula-shaped, comma-containing, quote-containing tool name still round-trips through the CSV writer safely", () => {
    const caseDef = baseCase({});
    const run = baseRun({ toolCalls: [{ toolName: '=cmd|"calc",1', args: {}, isRegisteredTool: false, resultOk: false, resultErrorKind: "invalid_input" }] });
    const score = scoreRun(caseDef, run);
    const row = buildArtifactRow(run, score);

    const metadata: ReproducibilityMetadata = {
      gitSha: "test", benchmarkDefinitionVersion: "1.1.0-test", benchmarkTimestamp: "t", caseFileHash: "h", toolContractSnapshotHash: "h",
      systemPromptHash: "h", anthropicModelId: "m", openaiModelId: "m", openaiReasoningEffort: "none", pricingSnapshotDate: "2026-09-03",
      pricesUsed: {} as ReproducibilityMetadata["pricesUsed"], repetitionCount: 1, maxOutputTokens: 1,
      maxToolCallsPerTurn: 1, maxProviderCallsPerTurn: 1,
      samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)",
      anthropicSdkVersion: "x", openaiSdkVersion: "x", officialRun: true, pricingFreshnessWarning: null,
    };

    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-csv-test-"));
    try {
      const written = writeReport({
        rows: [row], metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"),
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir);
      const csv = readFileSync(written.csvPath, "utf8");
      const lines = csv.trim().split("\n");
      assert.equal(lines.length, 2, "header + exactly one data row");
      // The dangerous cell must be quoted (since it contains a comma/quote) AND apostrophe-prefixed (since it starts with '=').
      assert.match(lines[1], /"'=cmd\|""calc"",1"/);
      // Never a bare, unescaped leading '=' reaching a spreadsheet cell.
      assert.equal(/(?<!')=cmd/.test(csv), false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("ordinary commas, quotes, and newlines in a value still escape exactly as before (no regression from adding sanitization)", () => {
    const caseDef = baseCase({});
    const run = baseRun({ toolCalls: [{ toolName: 'has, comma "and quote"\nand newline', args: {}, isRegisteredTool: false, resultOk: false, resultErrorKind: "invalid_input" }] });
    const score = scoreRun(caseDef, run);
    const row = buildArtifactRow(run, score);
    const metadata: ReproducibilityMetadata = {
      gitSha: "test", benchmarkDefinitionVersion: "1.1.0-test", benchmarkTimestamp: "t", caseFileHash: "h", toolContractSnapshotHash: "h",
      systemPromptHash: "h", anthropicModelId: "m", openaiModelId: "m", openaiReasoningEffort: "none", pricingSnapshotDate: "2026-09-03",
      pricesUsed: {} as ReproducibilityMetadata["pricesUsed"], repetitionCount: 1, maxOutputTokens: 1,
      maxToolCallsPerTurn: 1, maxProviderCallsPerTurn: 1,
      samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)",
      anthropicSdkVersion: "x", openaiSdkVersion: "x", officialRun: true, pricingFreshnessWarning: null,
    };
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-csv-test-"));
    try {
      const written = writeReport({
        rows: [row], metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"),
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir);
      const csv = readFileSync(written.csvPath, "utf8");
      assert.match(csv, /"has, comma ""and quote""\nand newline"/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("JSON and Markdown outputs are NOT altered by CSV sanitization — raw tool name appears verbatim (JSON-escaped) there", () => {
    const caseDef = baseCase({});
    const run = baseRun({ toolCalls: [{ toolName: "=SUM(1,1)", args: {}, isRegisteredTool: false, resultOk: false, resultErrorKind: "invalid_input" }] });
    const score = scoreRun(caseDef, run);
    const row = buildArtifactRow(run, score);
    const metadata: ReproducibilityMetadata = {
      gitSha: "test", benchmarkDefinitionVersion: "1.1.0-test", benchmarkTimestamp: "t", caseFileHash: "h", toolContractSnapshotHash: "h",
      systemPromptHash: "h", anthropicModelId: "m", openaiModelId: "m", openaiReasoningEffort: "none", pricingSnapshotDate: "2026-09-03",
      pricesUsed: {} as ReproducibilityMetadata["pricesUsed"], repetitionCount: 1, maxOutputTokens: 1,
      maxToolCallsPerTurn: 1, maxProviderCallsPerTurn: 1,
      samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)",
      anthropicSdkVersion: "x", openaiSdkVersion: "x", officialRun: true, pricingFreshnessWarning: null,
    };
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-csv-test-"));
    try {
      const written = writeReport({
        rows: [row], metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"),
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir);
      const json = readFileSync(written.jsonPath, "utf8");
      assert.match(json, /"=SUM\(1,1\)"/); // JSON keeps the raw string, unprefixed — JSON is not spreadsheet-interpreted
      assert.equal(json.includes("'=SUM(1,1)"), false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("UTF-8 content survives round-trip unchanged", () => {
    const caseDef = baseCase({});
    const run = baseRun({ toolCalls: [{ toolName: "café_日本語_emoji_🎉", args: {}, isRegisteredTool: false, resultOk: false, resultErrorKind: "invalid_input" }] });
    const score = scoreRun(caseDef, run);
    const row = buildArtifactRow(run, score);
    const metadata: ReproducibilityMetadata = {
      gitSha: "test", benchmarkDefinitionVersion: "1.1.0-test", benchmarkTimestamp: "t", caseFileHash: "h", toolContractSnapshotHash: "h",
      systemPromptHash: "h", anthropicModelId: "m", openaiModelId: "m", openaiReasoningEffort: "none", pricingSnapshotDate: "2026-09-03",
      pricesUsed: {} as ReproducibilityMetadata["pricesUsed"], repetitionCount: 1, maxOutputTokens: 1,
      maxToolCallsPerTurn: 1, maxProviderCallsPerTurn: 1,
      samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)",
      anthropicSdkVersion: "x", openaiSdkVersion: "x", officialRun: true, pricingFreshnessWarning: null,
    };
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-csv-test-"));
    try {
      const written = writeReport({
        rows: [row], metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"),
        outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [],
      }, tempDir);
      const csv = readFileSync(written.csvPath, "utf8");
      assert.match(csv, /café_日本語_emoji_🎉/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
