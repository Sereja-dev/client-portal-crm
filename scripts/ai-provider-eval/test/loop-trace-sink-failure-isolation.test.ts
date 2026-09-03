/**
 * Isolated Aqenra AI provider benchmark harness — forensic trace sink
 * FAILURE ISOLATION (fast-follow hardening after PR #184's own strict
 * audit finding: a throwing TraceSink callback previously propagated out
 * of runBenchmarkTurn() and could abort an entire live sweep).
 *
 * Bug reproduction (this file's own first describe() block): proves,
 * against a plain hand-built throwing sink (not routed through
 * forensic-trace.ts's own collector, to isolate loop.ts's own contract
 * from any one collector implementation's behavior), that
 * runBenchmarkTurn() never rejects/throws merely because a trace-sink
 * callback threw — for both onProviderCall and onToolResult, and across
 * ordinary/protocol-violation/error provider-turn kinds.
 *
 * Everything below this also re-proves observational equivalence (§42 of
 * PR #184, extended here to a THIRD condition — a throwing sink) and the
 * two specific throw-timing regressions the audit called out by name:
 * onProviderCall throwing on the very first response, and onToolResult
 * throwing immediately after a real synthetic tool result exists.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import { createRunTraceCollector } from "../forensic-trace.js";
import type { NormalizedProviderTurn, TraceSink } from "../result-types.js";

const USAGE = { promptTokens: 12, completionTokens: 7, totalTokens: 19 };
const CASE_DEF = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;

function scripted(turns: NormalizedProviderTurn[]): ProviderCompleteFn {
  let cursor = 0;
  return async () => {
    const turn = turns[cursor];
    cursor += 1;
    return turn;
  };
}

function toolThenTextSequence(): NormalizedProviderTurn[] {
  return [
    { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: "Cobalt" } }, usage: USAGE } },
    { kind: "ok", response: { kind: "text", text: "There are 2 matching clients.", usage: USAGE } },
  ];
}

/** A sink whose onProviderCall throws on every invocation — deliberately NOT forensic-trace.ts's own collector, so this proves loop.ts's OWN contract holds for any TraceSink implementation, not just the one this package ships. */
function throwingOnProviderCallSink(): TraceSink {
  return {
    onProviderCall: () => {
      throw new Error("SIMULATED onProviderCall BUG");
    },
  };
}

function throwingOnToolResultSink(): TraceSink {
  return {
    onToolResult: () => {
      throw new Error("SIMULATED onToolResult BUG");
    },
  };
}

describe("loop.ts — bug reproduction: a throwing traceSink must never abort runBenchmarkTurn() (fast-follow after PR #184's audit finding)", () => {
  test("a throwing onProviderCall does not reject runBenchmarkTurn() for an ordinary text-response run", async () => {
    const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } };
    await assert.doesNotReject(
      runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted([turn]), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwingOnProviderCallSink() }),
    );
  });

  test("a throwing onProviderCall does not reject runBenchmarkTurn() for a protocol_violation turn", async () => {
    const violation: NormalizedProviderTurn = { kind: "protocol_violation", message: "returned 2 tool calls", rawToolCalls: [{ toolName: "searchClients", args: {} }, { toolName: "searchProjects", args: {} }] };
    await assert.doesNotReject(
      runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([violation]), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwingOnProviderCallSink() }),
    );
  });

  test("a throwing onProviderCall does not reject runBenchmarkTurn() for a provider-error turn", async () => {
    const err: NormalizedProviderTurn = { kind: "error", error: { kind: "rate_limited", message: "429" } };
    await assert.doesNotReject(
      runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([err]), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwingOnProviderCallSink() }),
    );
  });

  test("a throwing onToolResult does not reject runBenchmarkTurn() for a tool-call-then-text run", async () => {
    await assert.doesNotReject(
      runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(toolThenTextSequence()), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwingOnToolResultSink() }),
    );
  });
});

describe("loop.ts — observational equivalence, extended to a THROWING sink (A: none, B: healthy, C: throwing)", () => {
  test("identical finalText, toolSequence, tool args/outcomes, provider-call count, tool-call count, protocol status, errorClass, usage, and cost across all three conditions — ordinary multi-turn run", async () => {
    const estimateCostUsd = (p: number, c: number) => p * 0.000003 + c * 0.000015;

    const resultA = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(toolThenTextSequence()), userMessage: CASE_DEF.prompt, estimateCostUsd });

    const healthyCollector = createRunTraceCollector();
    const resultB = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(toolThenTextSequence()), userMessage: CASE_DEF.prompt, estimateCostUsd, traceSink: healthyCollector.sink });

    const throwingSink: TraceSink = {
      onProviderCall: () => { throw new Error("SIMULATED onProviderCall BUG"); },
      onToolResult: () => { throw new Error("SIMULATED onToolResult BUG"); },
    };
    const resultC = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(toolThenTextSequence()), userMessage: CASE_DEF.prompt, estimateCostUsd, traceSink: throwingSink });

    const observable = (r: typeof resultA) => ({
      finalText: r.finalText,
      toolSequence: r.toolCalls.map((t) => t.toolName),
      toolArgsOutcomes: r.toolCalls.map((t) => ({ args: t.args, isRegisteredTool: t.isRegisteredTool, resultOk: t.resultOk, resultErrorKind: t.resultErrorKind })),
      providerCallCount: r.providerCalls.length,
      toolCallCount: r.toolCalls.length,
      protocolViolation: r.protocolViolation,
      errorClass: r.errorClass,
      totalUsage: r.totalUsage,
      estimatedCostUsd: r.estimatedCostUsd,
    });

    assert.deepEqual(observable(resultB), observable(resultA), "B (healthy sink) must match A (no sink)");
    assert.deepEqual(observable(resultC), observable(resultA), "C (throwing sink) must match A (no sink) — a broken sink changes NOTHING observable");

    // The only actual difference: B captured real events, C recorded a capture failure.
    assert.ok(healthyCollector.getTurns().length > 0);
    assert.equal(healthyCollector.getCaptureFailure(), null);

    // Scorer result identical too — re-run the real scorer against each RunResult.
    const scoreA = scoreRun(CASE_DEF, { ...resultA, caseId: CASE_DEF.id, repetition: 1 });
    const scoreB = scoreRun(CASE_DEF, { ...resultB, caseId: CASE_DEF.id, repetition: 1 });
    const scoreC = scoreRun(CASE_DEF, { ...resultC, caseId: CASE_DEF.id, repetition: 1 });
    assert.deepEqual(scoreB, scoreA);
    assert.deepEqual(scoreC, scoreA);
  });

  test("latency: a throwing sink stays outside the provider-call latency bracket, same as a healthy one (not exact-ms-equal, but not inflated by the failure path)", async () => {
    const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } };
    const throwingSlowSink: TraceSink = {
      onProviderCall: () => {
        const start = performance.now();
        while (performance.now() - start < 25) { /* busy-wait BEFORE throwing */ }
        throw new Error("SIMULATED slow, then throwing, onProviderCall");
      },
    };
    const result = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: async () => turn, userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwingSlowSink });
    assert.ok(result.providerCalls[0].latencyMs < 15, `expected provider-call latency to exclude the sink's own 25ms busy-wait-then-throw, got ${result.providerCalls[0].latencyMs}ms`);
  });
});

describe("loop.ts — §12 provider-call throw regression: onProviderCall throws on the FIRST provider response", () => {
  test("the model turn continues to a second provider call, tool execution proceeds, and the final answer is unaffected", async () => {
    let providerCallAttempts = 0;
    const throwOnlyOnFirstCall: TraceSink = {
      onProviderCall: () => {
        providerCallAttempts += 1;
        if (providerCallAttempts === 1) throw new Error("SIMULATED failure on the FIRST provider call only");
        // subsequent calls succeed — proves the loop's own control flow (not the sink) determines call count
      },
    };
    const control = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(toolThenTextSequence()), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0 });
    const withThrow = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(toolThenTextSequence()), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwOnlyOnFirstCall });

    assert.equal(providerCallAttempts, 2, "the sink must have been invoked for BOTH provider calls — the first throw did not stop the loop from calling it again on the second turn");
    assert.equal(withThrow.finalText, control.finalText);
    assert.equal(withThrow.providerCalls.length, control.providerCalls.length);
    assert.equal(withThrow.protocolViolation, false);
    assert.equal(withThrow.errorClass, null, "no provider error classification must be introduced by a sink failure");
  });
});

describe("loop.ts — §13 tool-result throw regression: onToolResult throws immediately after a valid synthetic tool result exists", () => {
  test("the exact same provider-visible tool result still drives the next model call, and the final answer matches the no-sink control", async () => {
    const control = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(toolThenTextSequence()), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0 });

    let onToolResultCalled = false;
    const throwingSink: TraceSink = {
      onToolResult: () => {
        onToolResultCalled = true;
        throw new Error("SIMULATED failure right after a real synthetic tool result exists");
      },
    };
    const withThrow = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: scripted(toolThenTextSequence()), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwingSink });

    assert.equal(onToolResultCalled, true);
    // If the (frozen, untouched) messages.push(...) content had been corrupted by the
    // throw, the second scripted provider turn would still fire (this stub ignores
    // request content), but toolCalls/finalText — which depend on the SAME toolResult
    // value used to build that message — would diverge from control if anything
    // upstream of the push had been mutated. They don't:
    assert.equal(withThrow.finalText, control.finalText);
    assert.deepEqual(withThrow.toolCalls, control.toolCalls);
    assert.equal(withThrow.providerCalls.length, control.providerCalls.length);
  });
});

/** Strips genuinely non-deterministic wall-clock timing fields before a strict deep-equal — see loop.test.ts's own established convention: semantic fields are compared exactly, latency is only ever asserted as a bound, never exact-ms-equal across two independent invocations. */
function withoutTiming(run: Awaited<ReturnType<typeof runBenchmarkTurn>>) {
  return {
    ...run,
    totalLatencyMs: undefined,
    providerCalls: run.providerCalls.map((c) => ({ ...c, latencyMs: undefined })),
  };
}

describe("loop.ts — §14 protocol/error paths remain authoritative even with a throwing sink", () => {
  test("a protocol_violation is still reported as protocolViolation:true, errorClass 'protocol_violation' — never masked or replaced by the sink failure", async () => {
    const violation: NormalizedProviderTurn = { kind: "protocol_violation", message: "returned 2 tool calls", rawToolCalls: [{ toolName: "searchClients", args: {} }, { toolName: "searchProjects", args: {} }] };
    const control = await runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([violation]), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0 });
    const withThrow = await runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([violation]), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwingOnProviderCallSink() });

    assert.equal(withThrow.protocolViolation, true);
    assert.equal(withThrow.errorClass, "protocol_violation");
    assert.deepEqual(withoutTiming(withThrow), withoutTiming(control)); // identical RunResult (timing aside), sink or not
  });

  test("a normalized provider error is still reported with its real errorClass — never replaced by a sink-induced classification", async () => {
    const err: NormalizedProviderTurn = { kind: "error", error: { kind: "rate_limited", message: "429" } };
    const control = await runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([err]), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0 });
    const withThrow = await runBenchmarkTurn({ provider: "openai", model: "m", complete: scripted([err]), userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: throwingOnProviderCallSink() });

    assert.equal(withThrow.errorClass, "rate_limited");
    assert.deepEqual(withoutTiming(withThrow), withoutTiming(control));
  });
});

describe("loop.ts — safeEmitTraceEvent()'s catch+sanitize+notify contract, end to end through the real runBenchmarkTurn()", () => {
  test("a throwing onProviderCall's message reaches onCaptureFailure already redacted and length-bounded — never a raw Error/stack/secret", async () => {
    // NB: describeTurn()/deepRedact() (createRunTraceCollector()'s own
    // implementation) cannot actually be made to throw via a REAL
    // runBenchmarkTurn() call: loop.ts already JSON.stringifies a
    // toolCall's own `args` for the assistant message BEFORE tracing
    // ever sees it (so a circular/getter-throwing args value crashes
    // loop.ts's own core logic first, unrelated to tracing — see
    // test/forensic-trace-writer.test.ts's direct deepRedact() unit
    // tests for that specific, already-covered failure mode instead),
    // and a tool RESULT is always JSON.parse()-derived before tracing
    // sees it (never circular by construction). This test instead
    // proves the safeEmitTraceEvent() contract directly, with a
    // hand-built sink whose onProviderCall throws a message containing
    // a live secret value — the only realistic way ANY future sink
    // implementation, buggy or not, could ever actually throw.
    process.env.AQENRA_EVAL_ANTHROPIC_API_KEY = "sk-ant-test-fake-key-for-this-test-only";
    try {
      const receivedFailures: { message: string }[] = [];
      const secretBearingMessage = `boom sk-ant-test-fake-key-for-this-test-only ${"x".repeat(500)}`;
      const sink: TraceSink = {
        onProviderCall: () => {
          throw new Error(secretBearingMessage);
        },
        onCaptureFailure: (failure) => {
          receivedFailures.push(failure);
        },
      };
      const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } };
      const result = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete: async () => turn, userMessage: CASE_DEF.prompt, estimateCostUsd: () => 0, traceSink: sink });

      assert.equal(receivedFailures.length, 1, "onCaptureFailure must be notified exactly once");
      const failure = receivedFailures[0];
      assert.equal(typeof failure.message, "string");
      assert.equal(failure.message.includes("sk-ant-test-fake-key-for-this-test-only"), false, "the secret must be redacted before ever reaching onCaptureFailure");
      assert.ok(failure.message.includes("[REDACTED_ANTHROPIC_KEY]"));
      assert.ok(failure.message.length <= 210, `the sanitized message must be length-bounded, got ${failure.message.length} chars`);
      assert.equal(failure.message.includes("\n    at "), false, "must never contain a raw stack trace");
      assert.equal(Object.keys(failure).sort().join(","), "message", "must be a plain sanitized object — never the raw Error instance itself");

      // And the benchmark's own result is completely unaffected regardless.
      assert.equal(result.finalText, "hi");
    } finally {
      delete process.env.AQENRA_EVAL_ANTHROPIC_API_KEY;
    }
  });
});

describe("forensic-trace.ts — createRunTraceCollector()'s own onCaptureFailure/getCaptureFailure contract", () => {
  test("first-failure-wins: a second, different failure never overwrites the first recorded one", async () => {
    const collector = createRunTraceCollector();
    // Directly exercise the sink contract as loop.ts's safeEmitTraceEvent() would.
    collector.sink.onCaptureFailure?.({ message: "first failure" });
    collector.sink.onCaptureFailure?.({ message: "second failure" });
    assert.deepEqual(collector.getCaptureFailure(), { message: "first failure" });
  });

  test("once a capture failure is recorded, further onProviderCall/onToolResult events are no-ops (getTurns() stops growing)", async () => {
    const collector = createRunTraceCollector();
    collector.sink.onCaptureFailure?.({ message: "simulated prior failure" });
    const turn: NormalizedProviderTurn = { kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } };
    collector.sink.onProviderCall?.({ callIndex: 0, latencyMs: 1, usage: USAGE, turn });
    assert.deepEqual(collector.getTurns(), [], "no further events may be collected once a capture failure has been recorded for this run");
  });
});
