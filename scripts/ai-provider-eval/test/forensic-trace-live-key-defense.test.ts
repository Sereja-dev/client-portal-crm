/**
 * Isolated Aqenra AI provider benchmark harness — forensic trace live-key
 * defense (PR 2, task §17).
 *
 * Sets FAKE/DUMMY values into the exact env vars secrets.ts reads
 * (AQENRA_EVAL_ANTHROPIC_API_KEY / AQENRA_EVAL_OPENAI_API_KEY — never a
 * real credential, see secrets.ts's own header comment), feeds those
 * exact fake values into every trace-candidate string (prompt-adjacent
 * text, a provider text response, a tool-call argument, a tool result,
 * and an error message), builds+writes the full trace through the real
 * writeForensicTrace() path, and proves the fake value appears NOWHERE in
 * the written file's bytes.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import { BENCHMARK_DEFINITION_VERSION } from "../benchmark-version.js";
import type { NormalizedProviderTurn, RunResult } from "../result-types.js";
import { FORENSIC_TRACE_SCHEMA_VERSION, createRunTraceCollector, buildForensicTraceRow, writeForensicTrace, type ForensicTraceRow } from "../forensic-trace.js";

const ENV_KEYS = ["AQENRA_EVAL_ANTHROPIC_API_KEY", "AQENRA_EVAL_OPENAI_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
const FAKE_ANTHROPIC_KEY = "sk-ant-FAKE-DUMMY-eval-secret-0000000000";
const FAKE_OPENAI_KEY = "sk-FAKE-DUMMY-eval-secret-1111111111";

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.AQENRA_EVAL_ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
  process.env.AQENRA_EVAL_OPENAI_API_KEY = FAKE_OPENAI_KEY;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const USAGE = { promptTokens: 3, completionTokens: 2, totalTokens: 5 };
const NON_DRAFTING_CASE = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;

function scripted(turns: NormalizedProviderTurn[]): ProviderCompleteFn {
  let cursor = 0;
  return async () => {
    const turn = turns[cursor];
    cursor += 1;
    return turn;
  };
}

describe("forensic-trace.ts — live-key defense (fake/dummy secret values only)", () => {
  test("a fake key value embedded in a provider text response, a tool-call argument, a tool result, and an error message never survives into the written trace file", async () => {
    // Row 1: fake ANTHROPIC key embedded in the tool args AND the final text.
    const collectorA = createRunTraceCollector();
    const runA: RunResult = {
      ...(await runBenchmarkTurn({
        provider: "anthropic",
        model: "claude-test-model",
        complete: scripted([
          { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: FAKE_ANTHROPIC_KEY } }, usage: USAGE } },
          { kind: "ok", response: { kind: "text", text: `Result includes token ${FAKE_ANTHROPIC_KEY} in the answer.`, usage: USAGE } },
        ]),
        userMessage: NON_DRAFTING_CASE.prompt,
        estimateCostUsd: () => 0,
        traceSink: collectorA.sink,
      })),
      caseId: NON_DRAFTING_CASE.id,
      repetition: 1,
    };
    const scoreA = scoreRun(NON_DRAFTING_CASE, runA);
    const rowResultA = buildForensicTraceRow({ caseDef: NON_DRAFTING_CASE, run: runA, score: scoreA, turns: collectorA.getTurns() });
    assert.equal(rowResultA.ok, true);

    // Row 2: fake OPENAI key embedded in a provider error message.
    const collectorB = createRunTraceCollector();
    const runB: RunResult = {
      ...(await runBenchmarkTurn({
        provider: "openai",
        model: "gpt-test-model",
        complete: scripted([{ kind: "error", error: { kind: "rate_limited", message: `429 using key ${FAKE_OPENAI_KEY}` } }]),
        userMessage: NON_DRAFTING_CASE.prompt,
        estimateCostUsd: () => 0,
        traceSink: collectorB.sink,
      })),
      caseId: NON_DRAFTING_CASE.id,
      repetition: 2,
    };
    const scoreB = scoreRun(NON_DRAFTING_CASE, runB);
    const rowResultB = buildForensicTraceRow({ caseDef: NON_DRAFTING_CASE, run: runB, score: scoreB, turns: collectorB.getTurns() });
    assert.equal(rowResultB.ok, true);

    if (!rowResultA.ok || !rowResultB.ok) return;

    const rows: ForensicTraceRow[] = [rowResultA.row, rowResultB.row];
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-forensic-trace-live-key-defense-test-"));
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
          repetitionCount: 2,
          rowCount: rows.length,
          complete: true,
          rows,
        },
        BENCHMARK_CASES,
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const written = readFileSync(result.path, "utf8");
      assert.equal(written.includes(FAKE_ANTHROPIC_KEY), false, "the fake Anthropic key value must never appear in the written trace");
      assert.equal(written.includes(FAKE_OPENAI_KEY), false, "the fake OpenAI key value must never appear in the written trace");
      assert.ok(written.includes("[REDACTED_ANTHROPIC_KEY]"));
      assert.ok(written.includes("[REDACTED_OPENAI_KEY]"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
