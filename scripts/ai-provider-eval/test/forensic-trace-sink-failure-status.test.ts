/**
 * Isolated Aqenra AI provider benchmark harness — proof that a forensic
 * trace sink failure propagates to forensicTraceStatus="requested_but_failed"
 * exactly like any other trace-build failure (fast-follow hardening after
 * PR #184's own audit finding), and that ordinary results/report
 * generation is completely unaffected.
 *
 * Mirrors index.ts's OWN sweep-loop wiring exactly (see runLiveBenchmark()'s
 * `const captureFailure = collector.getCaptureFailure(); traceRowResults.push(
 * captureFailure ? {ok:false,...} : buildForensicTraceRow(...))` pattern) —
 * this test reproduces that same logic against a hand-built throwing sink,
 * without spawning the live CLI (no keys, no network needed).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { scoreRun } from "../scoring.js";
import { buildArtifactRow, buildReproducibilityMetadata, writeReport, type ArtifactRow } from "../report.js";
import { BENCHMARK_CASES } from "../cases.js";
import { createRunTraceCollector, buildForensicTraceRow, type RowBuildResult } from "../forensic-trace.js";
import type { NormalizedProviderTurn, RunResult, TraceSink } from "../result-types.js";
import type { ProviderAggregate } from "../decision.js";

function perfectAgg(provider: "anthropic" | "openai"): ProviderAggregate {
  return {
    provider, totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100,
    uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0,
    medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100,
  };
}

/** Exactly mirrors index.ts's own per-row trace handling in runLiveBenchmark(). */
function pushTraceRowResult(traceRowResults: RowBuildResult[], collector: ReturnType<typeof createRunTraceCollector>, args: Parameters<typeof buildForensicTraceRow>[0]): void {
  const captureFailure = collector.getCaptureFailure();
  traceRowResults.push(
    captureFailure
      ? { ok: false, reason: `${args.caseDef.id}#rep${args.run.repetition} (${args.run.provider}): forensic trace capture failed during event collection — ${captureFailure.message}` }
      : buildForensicTraceRow(args),
  );
}

describe("index.ts's sweep-loop pattern — a sink capture failure feeds the exact same requested_but_failed status semantics", () => {
  test("collector.getCaptureFailure() non-null produces a RowBuildResult failure, never a built row", async () => {
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
    const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } };
    const throwingSink: TraceSink = { onProviderCall: () => { throw new Error("simulated sink bug"); } };

    const collector = createRunTraceCollector();
    // Wire the collector's own onCaptureFailure through the throwing sink,
    // exactly as loop.ts's safeEmitTraceEvent() would on a real throw.
    const combinedSink: TraceSink = { ...throwingSink, onCaptureFailure: collector.sink.onCaptureFailure };

    const run: RunResult = {
      ...(await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: async () => turn, userMessage: caseDef.prompt, estimateCostUsd: () => 0, traceSink: combinedSink })),
      caseId: caseDef.id,
      repetition: 1,
    };
    const score = scoreRun(caseDef, run);

    const traceRowResults: RowBuildResult[] = [];
    pushTraceRowResult(traceRowResults, collector, { caseDef, run, score, turns: collector.getTurns() });

    assert.equal(traceRowResults.length, 1);
    assert.equal(traceRowResults[0].ok, false);
    if (!traceRowResults[0].ok) {
      assert.match(traceRowResults[0].reason, /forensic trace capture failed during event collection/);
    }
    // The benchmark's own result is completely valid regardless.
    assert.equal(run.finalText, "hi");
  });
});

describe("results.json/report.md/results.csv proof — forensicTraceEnabled=true, forensicTraceStatus=requested_but_failed, ordinary metrics intact, no raw content leaks", () => {
  test("a simulated requested trace with a sink failure never writes forensic-trace.json, and ordinary artifacts are generated exactly as normal", async () => {
    const DISTINCTIVE_FINAL_TEXT = "distinctive-sink-failure-status-test-marker-91fd";
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
    const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: DISTINCTIVE_FINAL_TEXT, usage: USAGE } };
    const throwingSink: TraceSink = { onToolResult: () => { throw new Error("simulated sink bug"); }, onProviderCall: () => { throw new Error("simulated sink bug"); } };

    const collector = createRunTraceCollector();
    const combinedSink: TraceSink = { ...throwingSink, onCaptureFailure: collector.sink.onCaptureFailure };

    const complete: ProviderCompleteFn = async () => turn;
    const run: RunResult = {
      ...(await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: caseDef.prompt, estimateCostUsd: () => 0, traceSink: combinedSink })),
      caseId: caseDef.id,
      repetition: 1,
    };
    const score = scoreRun(caseDef, run);
    const rows: ArtifactRow[] = [buildArtifactRow(run, score)];

    const traceRowResults: RowBuildResult[] = [];
    pushTraceRowResult(traceRowResults, collector, { caseDef, run, score, turns: collector.getTurns() });

    // Exactly index.ts's own status-derivation logic.
    const failedRow = traceRowResults.find((r) => !r.ok);
    const forensicTraceStatus: "captured" | "requested_but_failed" | "not_requested" = failedRow ? "requested_but_failed" : "captured";
    assert.equal(forensicTraceStatus, "requested_but_failed");

    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-sink-failure-status-test-"));
    try {
      const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true, forensicTraceEnabled: true, forensicTraceStatus });
      const written = writeReport(
        { rows, metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"), outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [] },
        tempDir,
      );

      // No forensic-trace.json is ever written for this simulated run (mirrors index.ts's own ordering: writeForensicTrace() is only ever called in the non-failed branch).
      assert.equal(existsSync(join(tempDir, "forensic-trace.json")), false);
      assert.equal(existsSync(join(tempDir, ".forensic-trace.json.tmp")), false);

      const json = readFileSync(written.jsonPath, "utf8");
      const csv = readFileSync(written.csvPath, "utf8");
      const markdown = readFileSync(written.markdownPath, "utf8");

      // Status correctly recorded.
      assert.ok(json.includes('"forensicTraceEnabled": true') || json.includes('"forensicTraceEnabled":true'));
      assert.ok(json.includes('"forensicTraceStatus": "requested_but_failed"') || json.includes('"forensicTraceStatus":"requested_but_failed"'));
      assert.match(markdown, /Forensic trace: requested — status `requested_but_failed`/);

      // Ordinary metrics/results remain present — the parsed JSON still has real rows/aggregates.
      const parsed = JSON.parse(json) as { rows: unknown[]; anthropic: unknown; openai: unknown; outcome: string };
      assert.equal(parsed.rows.length, 1);
      assert.ok(parsed.anthropic);
      assert.ok(parsed.openai);
      assert.equal(parsed.outcome, "TIE_ADDITIONAL_EVIDENCE_REQUIRED");

      // No raw trace payload (the model's own finalText) ever leaks into any of the three artifacts.
      for (const [name, content] of [["results.json", json], ["results.csv", csv], ["report.md", markdown]] as const) {
        assert.equal(content.includes(DISTINCTIVE_FINAL_TEXT), false, `${name} must never contain the raw finalText, sink failure or not`);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
