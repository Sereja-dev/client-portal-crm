/**
 * Isolated Aqenra AI provider benchmark harness — benchmark-only minimal
 * orchestration loop.
 *
 * Deliberately NOT a reuse of src/lib/ai/orchestrate.ts. That file pulls
 * in logging-policy.ts (writes a metadata-only log event) and is marked
 * `import "server-only"` — reusing it would either drag those concerns
 * into an isolated benchmark process or require stubbing them, which
 * risks silently changing the very control-flow semantics under test.
 * This file instead mirrors orchestrate.ts's own semantics directly and
 * narrowly:
 *   - one initial provider call
 *   - at most MAX_TOOL_CALLS_PER_TURN executed tool calls
 *   - at most MAX_PROVIDER_CALLS_PER_TURN total provider calls
 *   - one tool result fed back per round, using the exact same
 *     JSON-string-encoded {role:"assistant",content:JSON.stringify(...)}
 *     / {role:"tool",content:JSON.stringify(...)} convention
 *     orchestrate.ts's own loop uses (see providers/anthropic.ts and
 *     providers/openai.ts's own header comments for why each adapter
 *     must translate that convention into its vendor's native shape)
 *   - terminates on a final text response
 *   - zero automatic retries (a transport failure surfaces as a run
 *     error, never silently retried inside this loop — see README's own
 *     "Retry fairness" section for what the OPERATOR does with that)
 *   - hard-fails (does not execute the tool, does not call the provider
 *     again) if the ceiling is exceeded
 *   - hard-fails as a protocol_violation if a provider response itself
 *     already reported more than one tool call (see providers/*.ts's own
 *     NormalizedProviderTurn "protocol_violation" kind) — this loop never
 *     silently takes the first and discards the rest
 *   - resolves a requested tool name only against the exact six fixture
 *     tools (tool-runtime.ts's BENCHMARK_TOOLS) — an unrecognized name is
 *     recorded as a failed tool-call trace, never executed
 *   - never executes a mutation — impossible by construction, since
 *     BENCHMARK_TOOLS contains only the six read-only fixture executors
 *
 * Reuses the REAL src/lib/ai/system-prompt.ts and
 * src/lib/ai/orchestration-limits.ts directly (both zero-dependency, see
 * test/source-isolation.test.ts) — so the benchmark's own ceilings and
 * system prompt can never silently drift from production's.
 */

import type { AiMessage, AiRequest, AiToolCall } from "../../src/lib/ai/provider.js";
import { getAiAssistantSystemPrompt } from "../../src/lib/ai/system-prompt.js";
import {
  MAX_OUTPUT_TOKENS,
  MAX_PROVIDER_CALLS_PER_TURN,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TOOL_RESULT_SERIALIZED_CHARS,
  ORCHESTRATION_DEADLINE_MS,
  PROVIDER_CALL_TIMEOUT_MS,
} from "../../src/lib/ai/orchestration-limits.js";
import { BENCHMARK_TOOLS, getBenchmarkToolByName } from "./tool-runtime.js";
import type { BenchmarkProviderId, NormalizedProviderTurn, ProviderCallTrace, RunResult, ToolCallTrace, TraceSink } from "./result-types.js";

/** Fixed, arbitrary — the fixture tool executors ignore it entirely (see tool-runtime.ts, which operates on one single hardcoded synthetic organization), but every AiToolDefinition.execute() still requires a first argument, matching production's own signature exactly. */
const BENCHMARK_ORGANIZATION_ID = "benchmark-fixture-org";

export type ProviderCompleteFn = (request: AiRequest, options: { signal?: AbortSignal }) => Promise<NormalizedProviderTurn>;

export type RunBenchmarkTurnInput = {
  provider: BenchmarkProviderId;
  model: string;
  complete: ProviderCompleteFn;
  userMessage: string;
  estimateCostUsd: (promptTokens: number, completionTokens: number) => number;
  /** Per-provider-call timeout, mirroring PROVIDER_CALL_TIMEOUT_MS — a real AbortController is used here (unlike orchestrate.ts's own Promise.race, which does not cancel the underlying call), since this benchmark's own §20 goal is bounded network behavior, not a proposal to change provider.ts. */
  timeoutMs?: number;
  /** Optional, observation-only (see result-types.ts's own TraceSink doc comment). Omitted by every call site that doesn't opt into forensic tracing — behavior is byte-identical to before this field existed in that case. */
  traceSink?: TraceSink;
};

async function callWithTimeout(complete: ProviderCompleteFn, request: AiRequest, timeoutMs: number): Promise<{ turn: NormalizedProviderTurn; timedOut: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const turn = await complete(request, { signal: controller.signal });
    return { turn, timedOut: false };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { turn: { kind: "error", error: { kind: "timeout", message: "Benchmark-local timeout aborted the request." } }, timedOut: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function toolResultJson(toolName: string, executed: boolean, resultOk: boolean, resultErrorKind: string | null, resultPayload: unknown): string {
  const serialized = JSON.stringify({ toolName, result: resultPayload });
  if (serialized.length > MAX_TOOL_RESULT_SERIALIZED_CHARS) {
    // Mirrors orchestrate.ts's own oversized-result guard exactly.
    return JSON.stringify({ toolName, result: { ok: false, error: "unavailable" } });
  }
  return serialized;
}

export async function runBenchmarkTurn(input: RunBenchmarkTurnInput): Promise<RunResult> {
  const { provider, model, complete, userMessage, estimateCostUsd, traceSink } = input;
  const timeoutMs = input.timeoutMs ?? PROVIDER_CALL_TIMEOUT_MS;
  const startedAt = performance.now();

  const messages: AiMessage[] = [{ role: "user", content: userMessage }];
  const providerCalls: ProviderCallTrace[] = [];
  const toolCalls: ToolCallTrace[] = [];
  let providerCallCount = 0;
  let toolCallCount = 0;
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let totalCostUsd = 0;

  function finish(finalText: string | null, protocolViolation: boolean, errorClass: RunResult["errorClass"]): RunResult {
    return {
      caseId: "", // filled in by index.ts's own caller, which knows the case id this run belongs to
      repetition: 0, // filled in by index.ts's own caller
      provider,
      model,
      finalText,
      providerCalls,
      toolCalls,
      protocolViolation,
      errorClass,
      totalLatencyMs: performance.now() - startedAt,
      totalUsage,
      estimatedCostUsd: totalCostUsd,
    };
  }

  while (true) {
    if (performance.now() - startedAt > ORCHESTRATION_DEADLINE_MS) {
      return finish(null, false, "timeout");
    }
    if (providerCallCount >= MAX_PROVIDER_CALLS_PER_TURN) {
      return finish(null, false, "protocol_violation");
    }

    const request: AiRequest = {
      systemPrompt: getAiAssistantSystemPrompt(),
      messages: [...messages],
      tools: BENCHMARK_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs,
    };

    const callIndex = providerCallCount;
    const callStartedAt = performance.now();
    const { turn } = await callWithTimeout(complete, request, timeoutMs);
    const callLatencyMs = performance.now() - callStartedAt;
    providerCallCount += 1;

    if (turn.kind === "error") {
      providerCalls.push({ index: callIndex, latencyMs: callLatencyMs, usage: null, outcome: { kind: "error", error: turn.error } });
      traceSink?.onProviderCall?.({ callIndex, latencyMs: callLatencyMs, usage: null, turn });
      return finish(null, false, turn.error.kind);
    }

    if (turn.kind === "protocol_violation") {
      providerCalls.push({ index: callIndex, latencyMs: callLatencyMs, usage: null, outcome: { kind: "error", error: { kind: "protocol_violation", message: turn.message } } });
      traceSink?.onProviderCall?.({ callIndex, latencyMs: callLatencyMs, usage: null, turn });
      return finish(null, true, "protocol_violation");
    }

    const response = turn.response;
    totalUsage = {
      promptTokens: totalUsage.promptTokens + response.usage.promptTokens,
      completionTokens: totalUsage.completionTokens + response.usage.completionTokens,
      totalTokens: totalUsage.totalTokens + response.usage.totalTokens,
    };
    totalCostUsd += estimateCostUsd(response.usage.promptTokens, response.usage.completionTokens);

    if (response.kind === "text") {
      providerCalls.push({ index: callIndex, latencyMs: callLatencyMs, usage: response.usage, outcome: { kind: "text" } });
      traceSink?.onProviderCall?.({ callIndex, latencyMs: callLatencyMs, usage: response.usage, turn });
      return finish(response.text, false, null);
    }

    // kind === "toolCall"
    const call: AiToolCall = response.call;
    providerCalls.push({ index: callIndex, latencyMs: callLatencyMs, usage: response.usage, outcome: { kind: "toolCall", toolName: call.toolName, args: call.args } });
    traceSink?.onProviderCall?.({ callIndex, latencyMs: callLatencyMs, usage: response.usage, turn });

    toolCallCount += 1;
    if (toolCallCount > MAX_TOOL_CALLS_PER_TURN) {
      return finish(null, false, "protocol_violation");
    }

    const tool = getBenchmarkToolByName(call.toolName);
    messages.push({ role: "assistant", content: JSON.stringify({ toolName: call.toolName, args: call.args }) });

    if (!tool) {
      const unregisteredResult = { ok: false, error: "invalid_input" };
      toolCalls.push({ toolName: call.toolName, args: call.args, isRegisteredTool: false, resultOk: false, resultErrorKind: "invalid_input" });
      traceSink?.onToolResult?.({ toolName: call.toolName, args: call.args, result: unregisteredResult });
      messages.push({ role: "tool", content: JSON.stringify({ toolName: call.toolName, result: unregisteredResult }) });
      continue;
    }

    let toolResult: unknown;
    try {
      toolResult = await tool.execute(BENCHMARK_ORGANIZATION_ID, call.args);
    } catch {
      toolResult = { ok: false, error: "unavailable" };
    }

    const resultOk = typeof toolResult === "object" && toolResult !== null && (toolResult as { ok?: unknown }).ok === true;
    const resultErrorKind = resultOk ? null : ((toolResult as { error?: string })?.error ?? "unavailable");
    toolCalls.push({ toolName: call.toolName, args: call.args, isRegisteredTool: true, resultOk, resultErrorKind: resultErrorKind as ToolCallTrace["resultErrorKind"] });
    // Trace the EXACT provider-visible representation (post-oversized-result-guard, see
    // toolResultJson() below), never the larger hidden original if the guard replaced it —
    // "the trace must show what the provider actually received" (see forensic-trace.ts).
    const providerVisibleResultJson = toolResultJson(call.toolName, true, resultOk, resultErrorKind, toolResult);
    const providerVisibleResult: unknown = (JSON.parse(providerVisibleResultJson) as { toolName: string; result: unknown }).result;
    traceSink?.onToolResult?.({ toolName: call.toolName, args: call.args, result: providerVisibleResult });

    messages.push({ role: "tool", content: providerVisibleResultJson });
  }
}
