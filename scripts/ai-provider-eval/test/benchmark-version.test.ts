/**
 * Proves BENCHMARK_DEFINITION_VERSION (benchmark-version.ts) is present,
 * well-formed, and actually reaches reproducibility metadata / results.json
 * — never silently omitted. See README.md's own "Benchmark definition
 * version" section for the bump-discipline policy this constant is
 * governed by (not automatically enforced here — a human decision, not a
 * git-history inference, per that section's own explicit instruction).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BENCHMARK_DEFINITION_VERSION } from "../benchmark-version.js";
import { buildReproducibilityMetadata, writeReport } from "../report.js";
import { readFileSync } from "node:fs";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

describe("benchmark-version.ts — BENCHMARK_DEFINITION_VERSION", () => {
  test("is a non-empty string in x.y.z form", () => {
    assert.equal(typeof BENCHMARK_DEFINITION_VERSION, "string");
    assert.match(BENCHMARK_DEFINITION_VERSION, SEMVER_PATTERN);
  });

  test("is not the pre-versioning placeholder — this PR's own migration must have bumped it to 1.1.0", () => {
    assert.equal(BENCHMARK_DEFINITION_VERSION, "1.1.0");
  });

  test("buildReproducibilityMetadata() includes it", () => {
    const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true });
    assert.equal(metadata.benchmarkDefinitionVersion, BENCHMARK_DEFINITION_VERSION);
  });

  test("writeReport() persists it into results.json and surfaces it in report.md, before the buried JSON dump", () => {
    const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true });
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-benchmark-version-test-"));
    try {
      const written = writeReport(
        {
          rows: [],
          metadata,
          anthropic: { provider: "anthropic", totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100, uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0, medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100 },
          openai: { provider: "openai", totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100, uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0, medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100 },
          outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED",
          anthropicGateFailures: [],
          openaiGateFailures: [],
        },
        tempDir,
      );

      const json = JSON.parse(readFileSync(written.jsonPath, "utf8"));
      assert.equal(json.metadata.benchmarkDefinitionVersion, BENCHMARK_DEFINITION_VERSION);

      const md = readFileSync(written.markdownPath, "utf8");
      const versionLineIndex = md.indexOf("Benchmark definition version");
      const jsonDumpIndex = md.indexOf("```json");
      assert.ok(versionLineIndex >= 0 && versionLineIndex < jsonDumpIndex, "the version must be surfaced prominently, not only inside the buried JSON dump");
      assert.match(md, new RegExp(`Benchmark definition version.*${BENCHMARK_DEFINITION_VERSION.replace(/\./g, "\\.")}`));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("the prior official archived run predates this field — documented as the implicit 1.0.0 predecessor, never reinterpreted as 1.1.0", () => {
    // This is a documentation/policy assertion, not a computed one: the
    // archived run at results.json SHA-256
    // 450349e960c551f64c993fb104a4347eab459c027984da75107bf3ecf3aced0e
    // has no benchmarkDefinitionVersion field at all (it predates this
    // PR). See benchmark-version.ts's own "History" doc comment and
    // README.md's own "Benchmark definition version" section for the
    // explicit immutability/non-comparability policy — nothing in this
    // repository may alter or rescore that archive.
    const current: string = BENCHMARK_DEFINITION_VERSION;
    assert.ok(current !== "1.0.0", "1.1.0 must be strictly newer than the implicit pre-versioning predecessor");
  });
});
