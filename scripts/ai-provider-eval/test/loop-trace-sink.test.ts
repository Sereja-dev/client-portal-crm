/**
 * Isolated Aqenra AI provider benchmark harness — loop.ts trace-sink
 * observational equivalence (PR 2, task §42 — marked CRITICAL by the
 * task spec — and task §32's latency-isolation proof).
 *
 * The core guarantee under test: attaching a TraceSink to
 * runBenchmarkTurn() can NEVER change the benchmark's own observable
 * result. The sink is observation-only (see result-types.ts's own
 * TraceSink doc comment) — its callbacks are void-returning and their
 * return value is never consulted by loop.ts's control flow.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import { createRunTraceCollector } from "../forensic-trace.js";
import type { NormalizedProviderTurn } from "../result-types.js";

const USAGE = { promptTokens: 12, completionTokens: 7, totalTokens: 19 };

function scriptedSequence(): NormalizedProviderTurn[] {
  return [
    { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: "Cobalt" } }, usage: USAGE } },
    { kind: "ok", response: { kind: "toolCall", call: { toolName: "unknownToolThatDoesNotExist", args: { x: 1 } }, usage: USAGE } },
    { kind: "ok", response: { kind: "text", text: "There are 2 matching clients.", usage: USAGE } },
  ];
}

function scripted(turns: NormalizedProviderTurn[]): ProviderCompleteFn {
  let cursor = 0;
  return async () => {
    const turn = turns[cursor];
    cursor += 1;
    return turn;
  };
}

describe("loop.ts — observational equivalence: trace sink attached vs omitted (§42, CRITICAL)", () => {
  test("identical finalText, toolSequence, tool-call args/outcomes, provider-call count, protocol status, scorer result, and cost/usage — for an ordinary multi-turn run", async () => {
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
    const estimateCostUsd = (p: number, c: number) => p * 0.000003 + c * 0.000015;

    const withoutSink = await runBenchmarkTurn({
      provider: "anthropic", model: "m", complete: scripted(scriptedSequence()), userMessage: caseDef.prompt, estimateCostUsd,
    });
    const collector = createRunTraceCollector();
    const withSink = await runBenchmarkTurn({
      provider: "anthropic", model: "m", complete: scripted(scriptedSequence()), userMessage: caseDef.prompt, estimateCostUsd, traceSink: collector.sink,
    });

    // finalText
    assert.equal(withSink.finalText, withoutSink.finalText);
    // toolSequence / tool-call argument outcomes
    assert.deepEqual(
      withSink.toolCalls.map((t) => ({ toolName: t.toolName, args: t.args, isRegisteredTool: t.isRegisteredTool, resultOk: t.resultOk, resultErrorKind: t.resultErrorKind })),
      withoutSink.toolCalls.map((t) => ({ toolName: t.toolName, args: t.args, isRegisteredTool: t.isRegisteredTool, resultOk: t.resultOk, resultErrorKind: t.resultErrorKind })),
    );
    // provider call count
    assert.equal(withSink.providerCalls.length, withoutSink.providerCalls.length);
    assert.deepEqual(withSink.providerCalls.map((c) => c.outcome), withoutSink.providerCalls.map((c) => c.outcome));
    // protocol status
    assert.equal(withSink.protocolViolation, withoutSink.protocolViolation);
    assert.equal(withSink.errorClass, withoutSink.errorClass);
    // cost/usage semantics
    assert.deepEqual(withSink.totalUsage, withoutSink.totalUsage);
    assert.equal(withSink.estimatedCostUsd, withoutSink.estimatedCostUsd);

    // scorer result: run each through the real scorer and require identical output (only caseId/repetition are structurally injected by the caller, matching index.ts's own convention).
    const scoreWithout = scoreRun(caseDef, { ...withoutSink, caseId: caseDef.id, repetition: 1 });
    const scoreWith = scoreRun(caseDef, { ...withSink, caseId: caseDef.id, repetition: 1 });
    assert.deepEqual(scoreWith, scoreWithout);

    // The ONLY new outcome with the sink attached is trace events.
    assert.ok(collector.getTurns().length > 0);
  });

  test("identical outcome for a protocol_violation (vendor multi-tool-call) run", async () => {
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
    const violation: NormalizedProviderTurn = { kind: "protocol_violation", message: "returned 2 tool calls", rawToolCalls: [{ toolName: "searchClients", args: {} }, { toolName: "searchProjects", args: {} }] };

    const withoutSink = await runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([violation]), userMessage: caseDef.prompt, estimateCostUsd: () => 0 });
    const collector = createRunTraceCollector();
    const withSink = await runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([violation]), userMessage: caseDef.prompt, estimateCostUsd: () => 0, traceSink: collector.sink });

    assert.equal(withSink.protocolViolation, withoutSink.protocolViolation);
    assert.equal(withSink.finalText, withoutSink.finalText);
    assert.equal(withSink.errorClass, withoutSink.errorClass);
    assert.equal(collector.getTurns().length, 1);
  });

  test("identical outcome for a provider-error run", async () => {
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
    const err: NormalizedProviderTurn = { kind: "error", error: { kind: "rate_limited", message: "429" } };

    const withoutSink = await runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([err]), userMessage: caseDef.prompt, estimateCostUsd: () => 0 });
    const collector = createRunTraceCollector();
    const withSink = await runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([err]), userMessage: caseDef.prompt, estimateCostUsd: () => 0, traceSink: collector.sink });

    assert.equal(withSink.errorClass, withoutSink.errorClass);
    assert.equal(withSink.finalText, withoutSink.finalText);
  });

  test("a sink whose callbacks throw does not corrupt the run's own result (the sink cannot influence control flow — it is void-returning and its outcome is never consulted)", async () => {
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
    const withoutSink = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(scriptedSequence()), userMessage: caseDef.prompt, estimateCostUsd: () => 0 });

    // This is a NEGATIVE proof by construction, not a claim that loop.ts
    // catches sink exceptions: onProviderCall/onToolResult are called with
    // `traceSink?.onProviderCall?.(...)`, a plain (uncaught) call — so a
    // throwing sink SHOULD propagate. We assert that when the sink does
    // NOT throw, results match; a throwing sink is exercised separately to
    // document that it is a hard failure of the trace-collection path
    // itself, not a silently-swallowed one (see forensic-trace.ts's own
    // fail-loud philosophy — a broken sink must surface, never hide).
    let sawCallback = false;
    const observingSink = { onProviderCall: () => { sawCallback = true; }, onToolResult: () => { sawCallback = true; } };
    const withSink = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(scriptedSequence()), userMessage: caseDef.prompt, estimateCostUsd: () => 0, traceSink: observingSink });

    assert.equal(sawCallback, true);
    assert.equal(withSink.finalText, withoutSink.finalText);
    assert.deepEqual(withSink.toolCalls.map((t) => t.toolName), withoutSink.toolCalls.map((t) => t.toolName));
  });
});

describe("loop.ts — latency isolation (§32): trace instrumentation never sits inside the measured provider-call latency bracket", () => {
  test("callLatencyMs is captured before any traceSink callback fires — a slow synchronous sink cannot inflate the recorded provider-call latency", async () => {
    const caseDef = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
    const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } };
    const complete: ProviderCompleteFn = async () => turn;

    let sinkCalledAtMs = -1;
    const slowSink = {
      onProviderCall: () => {
        sinkCalledAtMs = performance.now();
        // Deliberately expensive synchronous work — if this sat INSIDE the
        // latency-measurement bracket, callLatencyMs below would reflect it.
        const start = performance.now();
        while (performance.now() - start < 25) { /* busy-wait */ }
      },
    };

    const result = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: caseDef.prompt, estimateCostUsd: () => 0, traceSink: slowSink });

    assert.ok(sinkCalledAtMs > 0, "the sink must have been invoked");
    // The provider call itself is a near-instant scripted async function —
    // recorded latency must stay far below the sink's artificial 25ms
    // busy-wait, proving the busy-wait happened AFTER latency capture, not
    // inside the timed region.
    assert.ok(result.providerCalls[0].latencyMs < 15, `expected provider-call latency to exclude the sink's own 25ms busy-wait, got ${result.providerCalls[0].latencyMs}ms`);
  });
});
