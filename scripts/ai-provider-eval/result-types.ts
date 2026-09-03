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
