/**
 * Isolated Aqenra AI provider benchmark harness — proof that forensic
 * content never leaks into results.csv/report.md/results.json (PR 2,
 * task §45). Only the new forensicTraceEnabled/forensicTraceStatus
 * metadata flag may appear — never a raw finalText, tool-call argument,
 * or tool-result payload.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { scoreRun } from "../scoring.js";
import { buildArtifactRow, buildReproducibilityMetadata, writeReport, type ArtifactRow } from "../report.js";
import { BENCHMARK_CASES } from "../cases.js";
import type { NormalizedProviderTurn, RunResult } from "../result-types.js";
import type { ProviderAggregate } from "../decision.js";

function perfectAgg(provider: "anthropic" | "openai"): ProviderAggregate {
  return {
    provider, totalRuns: 1, validArgumentPct: 100, factualCorrectnessPct: 100, mutationCompliancePct: 100,
    uuidNoLeakPct: 100, unknownToolExecutionCount: 0, injectionViolationCount: 0, protocolViolationCount: 0,
    medianLatencyMs: 1, p90LatencyMs: 1, totalCostUsd: 0, toolCorrectnessScore: 100,
  };
}

describe("results.csv/report.md/results.json — never contain raw forensic content, even when forensicTraceEnabled is true", () => {
  test("a distinctive finalText string and a distinctive tool-arg string never appear in any written artifact; the trace status flag does", async () => {
    const DISTINCTIVE_FINAL_TEXT = "distinctive-final-text-marker-b81c-must-not-leak";
    const DISTINCTIVE_TOOL_ARG = "distinctive-tool-arg-marker-77fa-must-not-leak";
    const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;

    const turns: NormalizedProviderTurn[] = [
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: DISTINCTIVE_TOOL_ARG } }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: DISTINCTIVE_FINAL_TEXT, usage: USAGE } },
    ];
    let cursor = 0;
    const complete: ProviderCompleteFn = async () => turns[cursor++];

    const run: RunResult = {
      ...(await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: caseDef.prompt, estimateCostUsd: () => 0 })),
      caseId: caseDef.id,
      repetition: 1,
    };
    const score = scoreRun(caseDef, run);
    const rows: ArtifactRow[] = [buildArtifactRow(run, score)];

    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-csv-report-safety-test-"));
    try {
      const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true, forensicTraceEnabled: true, forensicTraceStatus: "captured" });
      const written = writeReport(
        { rows, metadata, anthropic: perfectAgg("anthropic"), openai: perfectAgg("openai"), outcome: "TIE_ADDITIONAL_EVIDENCE_REQUIRED", anthropicGateFailures: [], openaiGateFailures: [] },
        tempDir,
      );

      const csv = readFileSync(written.csvPath, "utf8");
      const markdown = readFileSync(written.markdownPath, "utf8");
      const json = readFileSync(written.jsonPath, "utf8");

      for (const [name, content] of [["results.csv", csv], ["report.md", markdown], ["results.json", json]] as const) {
        assert.equal(content.includes(DISTINCTIVE_FINAL_TEXT), false, `${name} must never contain a raw finalText payload`);
        assert.equal(content.includes(DISTINCTIVE_TOOL_ARG), false, `${name} must never contain a raw tool-call argument payload`);
      }

      // The status flag itself IS allowed to appear — it's metadata, not raw content.
      assert.match(markdown, /Forensic trace: requested — status `captured`/);
      assert.ok(json.includes('"forensicTraceEnabled": true') || json.includes('"forensicTraceEnabled":true'));
      assert.ok(json.includes('"forensicTraceStatus": "captured"') || json.includes('"forensicTraceStatus":"captured"'));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
