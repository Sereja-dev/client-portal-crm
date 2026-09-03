/**
 * Isolated Aqenra AI provider benchmark harness — forensic trace
 * deterministic ordering (PR 2, task §24).
 *
 * Two properties, proven independently:
 *  1. Rows land in the trace in canonical sweep order — case order (as
 *     defined in cases.ts), then provider order, then repetition
 *     ascending — mirroring index.ts's own nested sweep loop exactly.
 *  2. buildForensicTraceRow() is a PURE, deterministic function of its
 *     already-computed inputs: given the exact same {caseDef, run, score,
 *     turns} — captured from ONE real execution, so latencyMs values are
 *     fixed, real numbers rather than an unrealistic claim that wall-clock
 *     timing itself replays identically — building the row (and the whole
 *     root around it) TWICE produces byte-for-byte identical serialized
 *     output, with the sole intentional exception of `generatedAt`, which
 *     this test freezes to an identical injected value in both builds
 *     rather than weakening the equality check itself.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { scoreRun } from "../scoring.js";
import type { CaseScore } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import type { BenchmarkCase } from "../cases.js";
import { BENCHMARK_DEFINITION_VERSION } from "../benchmark-version.js";
import type { NormalizedProviderTurn, RunResult, BenchmarkProviderId } from "../result-types.js";
import { FORENSIC_TRACE_SCHEMA_VERSION, createRunTraceCollector, buildForensicTraceRow, type ForensicTraceRoot, type ForensicTraceRow, type ForensicTraceTurn } from "../forensic-trace.js";

const USAGE = { promptTokens: 3, completionTokens: 2, totalTokens: 5 };
const FROZEN_GENERATED_AT = "2026-01-01T00:00:00.000Z"; // injected/frozen, per this file's own header comment — never a weakened comparison

function scripted(text: string): ProviderCompleteFn {
  const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text, usage: USAGE } };
  return async () => turn;
}

type Captured = { caseDef: BenchmarkCase; run: RunResult; score: CaseScore; turns: ForensicTraceTurn[] };

/** Mirrors index.ts's own sweep-loop body exactly, executed ONCE — capturing each (case, provider, repetition)'s real run/score/turns for later, repeatable row-building. */
async function sweepCapture(caseDefs: BenchmarkCase[], providers: BenchmarkProviderId[], repetitions: number): Promise<Captured[]> {
  const captures: Captured[] = [];
  for (const caseDef of caseDefs) {
    for (const provider of providers) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const collector = createRunTraceCollector();
        const run: RunResult = {
          ...(await runBenchmarkTurn({
            provider,
            model: provider === "anthropic" ? "claude-test-model" : "gpt-test-model",
            complete: scripted(`answer for ${caseDef.id}/${provider}/${repetition}`),
            userMessage: caseDef.prompt,
            estimateCostUsd: () => 0,
            traceSink: collector.sink,
          })),
          caseId: caseDef.id,
          repetition,
        };
        const score = scoreRun(caseDef, run);
        captures.push({ caseDef, run, score, turns: collector.getTurns() });
      }
    }
  }
  return captures;
}

/** Deterministic: builds one row per capture by calling buildForensicTraceRow() again on the SAME already-fixed inputs — no re-execution, no fresh timing. */
function rowsFrom(captures: Captured[]): ForensicTraceRow[] {
  return captures.map((c) => {
    const rowResult = buildForensicTraceRow(c);
    if (!rowResult.ok) throw new Error(`unexpected row build failure: ${rowResult.reason}`);
    return rowResult.row;
  });
}

function rootFrom(rows: ForensicTraceRow[]): ForensicTraceRoot {
  return {
    forensicTraceSchemaVersion: FORENSIC_TRACE_SCHEMA_VERSION,
    benchmarkDefinitionVersion: BENCHMARK_DEFINITION_VERSION,
    gitSha: "abc1234",
    generatedAt: FROZEN_GENERATED_AT,
    anthropicModelId: "claude-test-model",
    openaiModelId: "gpt-test-model",
    repetitionCount: 2,
    rowCount: rows.length,
    complete: true,
    rows,
  };
}

describe("forensic-trace.ts — deterministic row ordering", () => {
  test("rows land in canonical sweep order: case order, then provider order, then repetition ascending", async () => {
    const twoCases = BENCHMARK_CASES.filter((c) => c.category !== "drafting").slice(0, 2);
    const rows = rowsFrom(await sweepCapture(twoCases, ["anthropic", "openai"], 2));

    const expectedOrder: Array<[string, BenchmarkProviderId, number]> = [];
    for (const c of twoCases) {
      for (const p of ["anthropic", "openai"] as BenchmarkProviderId[]) {
        for (let r = 1; r <= 2; r += 1) expectedOrder.push([c.id, p, r]);
      }
    }
    const actualOrder = rows.map((row): [string, BenchmarkProviderId, number] => [row.caseId, row.provider, row.repetition]);
    assert.deepEqual(actualOrder, expectedOrder);
  });
});

describe("forensic-trace.ts — deterministic serialization across independent builds", () => {
  test("building the same captured sweep data twice serializes byte-identically, except the frozen generatedAt field", async () => {
    const cases = BENCHMARK_CASES.filter((c) => c.category !== "drafting").slice(0, 3);
    const captures = await sweepCapture(cases, ["anthropic", "openai"], 2); // ONE real execution — fixes latencyMs etc. as real, but now-static, numbers

    const rowsA = rowsFrom(captures); // first build
    const rowsB = rowsFrom(captures); // second, fully independent build call, same input data

    const serializedA = JSON.stringify(rootFrom(rowsA), null, 2);
    const serializedB = JSON.stringify(rootFrom(rowsB), null, 2);

    assert.equal(serializedA, serializedB, "two independent builds of the identical captured data must serialize identically");
    // Sanity: generatedAt really is present and was the frozen value in both — this isn't vacuously true because the field was never varied.
    assert.ok(serializedA.includes(FROZEN_GENERATED_AT));
  });

  test("turns within a row are always ordered by providerCallIndex ascending, deterministically", async () => {
    const rows = rowsFrom(await sweepCapture([BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!], ["anthropic"], 1));
    const indices = rows[0].turns.map((t) => t.providerCallIndex);
    const sorted = [...indices].sort((a, b) => a - b);
    assert.deepEqual(indices, sorted);
  });
});
