/**
 * Isolated Aqenra AI provider benchmark harness — benchmark-local result
 * types. Every production type this harness needs (AiRequest, AiResponse,
 * AiProvider, AiToolSpec, AiToolCall, AiUsage, AiProviderErrorKind,
 * AiProviderError) is imported directly from the real, zero-dependency
 * src/lib/ai/provider.ts — never redeclared here, so there is no
 * possibility of the benchmark silently drifting from the real contract.
 * This file adds ONLY the extra, benchmark-only shapes production has no
 * use for (a vendor identity tag, a tool-call trace, a protocol-violation
 * error kind, per-case/run scoring outcomes) — production types
 * themselves are never modified.
 */

import type { AiProviderErrorKind, AiResponse, AiToolCall, AiUsage } from "../../src/lib/ai/provider";

export type BenchmarkProviderId = "anthropic" | "openai";

/** Production's own 5-value AiProviderErrorKind, plus two benchmark-only diagnostic categories that have no place in the app's real error contract (see provider.ts's own doc comment on why that type stays closed to 5). */
export type BenchmarkErrorKind = AiProviderErrorKind | "malformed_response" | "protocol_violation";

export type BenchmarkError = { kind: BenchmarkErrorKind; message: string };

/** One provider.complete()-equivalent call within a run — mirrors what orchestrate.ts's own loop would record, but this harness's own minimal loop (loop.ts) builds it directly rather than reusing orchestrate.ts (see loop.ts's own header comment for why). */
export type ProviderCallTrace = {
  index: number; // 0-based, in call order
  latencyMs: number;
  usage: AiUsage | null;
  outcome: { kind: "text" } | { kind: "toolCall"; toolName: string; args: unknown } | { kind: "error"; error: BenchmarkError };
};

/** Raw materials only — loop.ts records exactly what happened (which tool, what args, whether the fixture executor's own AiToolResult came back ok); the fine-grained "invented key / wrong enum / wrong ref / over-broad" classification (§23) is scoring.ts's own job, computed by comparing `args` against the tool's real inputSchema (from tool-runtime.ts's BENCHMARK_TOOLS) — kept out of loop.ts so the loop itself stays a thin, generic mirror of orchestrate.ts's control flow, not a second copy of validation logic. */
export type ToolCallTrace = {
  toolName: string;
  args: unknown;
  isRegisteredTool: boolean;
  resultOk: boolean;
  resultErrorKind: "invalid_input" | "not_found" | "unavailable" | null;
};

export type RunResult = {
  caseId: string;
  repetition: number; // 1-based
  provider: BenchmarkProviderId;
  model: string;
  finalText: string | null;
  providerCalls: ProviderCallTrace[];
  toolCalls: ToolCallTrace[];
  protocolViolation: boolean;
  errorClass: BenchmarkErrorKind | null;
  totalLatencyMs: number;
  totalUsage: AiUsage;
  estimatedCostUsd: number;
};

/** A single provider turn's raw normalized response plus which vendor request parameters were actually sent — kept separate from AiResponse itself so a benchmark adapter can report protocol-relevant detail (e.g. "vendor returned 2 tool calls despite disable_parallel_tool_use") without inventing a new AiResponse variant that doesn't exist in production. */
export type NormalizedProviderTurn =
  | { kind: "ok"; response: AiResponse }
  | { kind: "protocol_violation"; message: string; rawToolCalls: AiToolCall[] }
  | { kind: "error"; error: BenchmarkError };

/**
 * Observation-only forensic-trace hook (see forensic-trace.ts). Optional,
 * synchronous, void-returning — loop.ts invokes these at the exact points
 * where normalized data already exists and is about to be discarded,
 * purely as a side-channel notification. Nothing here can influence
 * loop.ts's own control flow: the sink's return value is never read, and
 * every existing call site that omits `traceSink` behaves byte-identically
 * to before this type existed (see test/loop-trace-sink.test.ts's own
 * observational-equivalence proof). Only ever built from data loop.ts
 * already computes for its own RunResult — never a raw SDK object (see
 * NormalizedProviderTurn's own doc comment: providers/*.ts already
 * normalize every vendor response before loop.ts sees it).
 */
export type TraceProviderCallEvent = {
  callIndex: number;
  latencyMs: number;
  usage: AiUsage | null;
  turn: NormalizedProviderTurn;
};

export type TraceToolResultEvent = {
  toolName: string;
  args: unknown;
  result: unknown;
};

/**
 * Sanitized description of why forensic-trace EVENT COLLECTION failed for
 * one run — built exclusively by loop.ts's own safeEmitTraceEvent()
 * instrumentation boundary (see TraceSink.onCaptureFailure's own doc
 * comment below), never constructed by a TraceSink implementation
 * itself. `message` has already been redacted (secrets.ts's own
 * redactPotentialSecrets()) and length-bounded before this object is
 * ever built — never a raw Error object, never a stack trace, never a
 * raw SDK/vendor error, never a secret. See
 * test/loop-trace-sink-failure-isolation.test.ts.
 */
export type TraceCaptureFailure = { message: string };

export type TraceSink = {
  onProviderCall?: (event: TraceProviderCallEvent) => void;
  onToolResult?: (event: TraceToolResultEvent) => void;
  /**
   * Called by loop.ts's own safeEmitTraceEvent() instrumentation
   * boundary — NEVER by a sink author directly — exactly once, the
   * first time onProviderCall/onToolResult throws for a given run. A
   * broken/throwing onProviderCall or onToolResult can therefore never
   * abort or alter runBenchmarkTurn()'s own control flow: the throw is
   * caught at that one instrumentation boundary regardless of which
   * TraceSink implementation is plugged in, and this is the sink's one
   * and only way to learn its own event collection failed. This
   * callback is itself ALSO invoked inside the same safe wrapper — a
   * throwing onCaptureFailure implementation is equally powerless to
   * escape. Optional; a sink that doesn't care can omit it entirely.
   */
  onCaptureFailure?: (failure: TraceCaptureFailure) => void;
};
