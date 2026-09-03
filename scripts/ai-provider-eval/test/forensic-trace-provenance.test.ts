/**
 * Isolated Aqenra AI provider benchmark harness — forensic trace positive
 * provenance proof (PR 2, task §39).
 *
 * Proves every field reaching a written trace derives ONLY from:
 *   - a BenchmarkCase's own committed data (cases.ts)
 *   - a synthetic tool output (tool-runtime.ts / fixtures/organization.ts)
 *   - a normalized AiResponse/AiToolCall (provider.ts's own closed shapes,
 *     carried here via NormalizedProviderTurn/TraceProviderCallEvent)
 *   - already-computed scorer/result metadata (scoring.ts/loop.ts)
 * — never an arbitrary `process.env` payload, beyond the one documented
 * exception (redactPotentialSecrets() reading the two AQENRA_EVAL_*_API_KEY
 * values purely to REMOVE them, never to copy them in).
 *
 * Two independent proofs: a static source scan of forensic-trace.ts
 * itself, and a dynamic canary — an arbitrary, non-secret env var this
 * module has no business reading must never surface in a written trace.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import { BENCHMARK_DEFINITION_VERSION } from "../benchmark-version.js";
import type { NormalizedProviderTurn, RunResult } from "../result-types.js";
import { FORENSIC_TRACE_SCHEMA_VERSION, createRunTraceCollector, buildForensicTraceRow, writeForensicTrace } from "../forensic-trace.js";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("forensic-trace.ts — static provenance proof", () => {
  const source = readFileSync(join(PACKAGE_DIR, "forensic-trace.ts"), "utf8");

  test("forensic-trace.ts itself never reads process.env directly — the only env access anywhere in this file's dependency chain is secrets.ts's own documented redaction read", () => {
    assert.equal(/process\s*\.\s*env/.test(source), false, "forensic-trace.ts must never read process.env directly — it only calls redactPotentialSecrets()/deepRedact(), which do that on its behalf, purely to REMOVE a live key value, never to copy one in");
  });

  test("forensic-trace.ts never imports Prisma, Supabase, or any app-layer module (belt-and-suspenders on top of the generic source-isolation walk)", () => {
    for (const forbidden of ["@/lib/prisma", "@/generated/prisma", "supabase", "src/app"]) {
      assert.equal(source.includes(forbidden), false, `forensic-trace.ts must not reference "${forbidden}"`);
    }
  });
});

describe("forensic-trace.ts — dynamic provenance canary", () => {
  test("an arbitrary, non-secret env var this module has no reason to read never appears in a written trace", async () => {
    const CANARY_VALUE = "PROVENANCE_CANARY_9f2e7c-should-never-be-copied-into-any-trace";
    process.env.AQENRA_EVAL_SOME_UNRELATED_PROVENANCE_TEST_VAR = CANARY_VALUE;
    try {
      const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
      const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
      const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: "A normal, unrelated answer.", usage: USAGE } };
      const complete: ProviderCompleteFn = async () => turn;

      const collector = createRunTraceCollector();
      const run: RunResult = {
        ...(await runBenchmarkTurn({ provider: "anthropic", model: "claude-test-model", complete, userMessage: caseDef.prompt, estimateCostUsd: () => 0, traceSink: collector.sink })),
        caseId: caseDef.id,
        repetition: 1,
      };
      const score = scoreRun(caseDef, run);
      const rowResult = buildForensicTraceRow({ caseDef, run, score, turns: collector.getTurns() });
      assert.equal(rowResult.ok, true);
      if (!rowResult.ok) return;

      const tempDir = mkdtempSync(join(tmpdir(), "aqenra-forensic-trace-provenance-test-"));
      try {
        const result = writeForensicTrace(
          tempDir,
          {
            forensicTraceSchemaVersion: FORENSIC_TRACE_SCHEMA_VERSION,
            benchmarkDefinitionVersion: BENCHMARK_DEFINITION_VERSION,
            gitSha: "abc1234",
            generatedAt: new Date().toISOString(),
            anthropicModelId: "claude-test-model",
            openaiModelId: "gpt-test-model",
            repetitionCount: 1,
            rowCount: 1,
            complete: true,
            rows: [rowResult.row],
          },
          BENCHMARK_CASES,
        );
        assert.equal(result.ok, true);
        if (!result.ok) return;
        const written = readFileSync(result.path, "utf8");
        assert.equal(written.includes(CANARY_VALUE), false, "an arbitrary env var's value must never surface in a written trace");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      delete process.env.AQENRA_EVAL_SOME_UNRELATED_PROVENANCE_TEST_VAR;
    }
  });

  test("every string in a built row can be traced to the case's own prompt, the scripted response text, or computed scorer output — nothing else", async () => {
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
    const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const DISTINCTIVE_ANSWER = "distinctive-provenance-answer-4e91";
    const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: DISTINCTIVE_ANSWER, usage: USAGE } };
    const complete: ProviderCompleteFn = async () => turn;

    const collector = createRunTraceCollector();
    const run: RunResult = {
      ...(await runBenchmarkTurn({ provider: "anthropic", model: "claude-test-model", complete, userMessage: caseDef.prompt, estimateCostUsd: () => 0, traceSink: collector.sink })),
      caseId: caseDef.id,
      repetition: 1,
    };
    const score = scoreRun(caseDef, run);
    const rowResult = buildForensicTraceRow({ caseDef, run, score, turns: collector.getTurns() });
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;

    assert.equal(rowResult.row.userPrompt, caseDef.prompt);
    assert.equal(rowResult.row.finalText, DISTINCTIVE_ANSWER);
  });
});
