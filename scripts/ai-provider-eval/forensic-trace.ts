/**
 * Isolated Aqenra AI provider benchmark harness — optional forensic
 * trace observability (PR 2, benchmark definition v1.1.0 unchanged —
 * see benchmark-version.ts).
 *
 * Supplementary evidence ONLY, opt-in via `--run --with-forensic-trace`
 * (see index.ts). `results.json` (report.ts) remains the stable,
 * always-generated, authoritative aggregate; SelectionOutcome, scorer
 * aggregates, cost, and provider request sequence are computed
 * identically whether or not this file's writer is ever invoked. This
 * module adds NOTHING to results.csv/report.md beyond a status flag —
 * see report.ts's own ReproducibilityMetadata additions.
 *
 * Data provenance (see test/forensic-trace-provenance.test.ts): every
 * value that reaches this module comes from exactly one of —
 *   - a BenchmarkCase's own `prompt` (cases.ts, committed, synthetic)
 *   - a RunResult/CaseScore already computed by loop.ts/scoring.ts
 *   - a TraceProviderCallEvent/TraceToolResultEvent (result-types.ts),
 *     themselves built only from NormalizedProviderTurn/AiToolCall —
 *     already-normalized types that never carry a raw vendor SDK
 *     object, header, or hidden-reasoning field (see provider.ts's own
 *     doc comment: providers/anthropic.ts and providers/openai.ts do
 *     that normalization BEFORE loop.ts ever sees a response; both
 *     adapters are untouched by this file).
 * No Prisma, no Supabase, no app database, no Production API, no
 * environment business data is reachable from any of the above.
 *
 * Chain-of-thought / hidden reasoning: structurally impossible to leak
 * here. AiResponse (provider.ts) only has `{kind:"text",text,usage}` or
 * `{kind:"toolCall",call,usage}` — there is no field this module could
 * read even if it tried. OpenAI's `reasoning_effort:"none"`
 * (openai-compat.ts) and Anthropic's absent extended-thinking parameter
 * are both untouched by this PR.
 */

import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { BenchmarkCase, BenchmarkCaseCategory } from "./cases.js";
import type { CaseScore } from "./scoring.js";
import type { BenchmarkProviderId, NormalizedProviderTurn, RunResult, TraceCaptureFailure, TraceProviderCallEvent, TraceSink, TraceToolResultEvent } from "./result-types.js";
import { redactPotentialSecrets } from "./secrets.js";
import { MAX_PROVIDER_CALLS_PER_TURN, MAX_TOOL_RESULT_SERIALIZED_CHARS } from "../../src/lib/ai/orchestration-limits.js";

/**
 * Independent of BENCHMARK_DEFINITION_VERSION (benchmark-version.ts):
 * this tracks the TRACE FILE's own structure, not benchmark case/scoring
 * semantics. Bump ONLY when this file's own row/turn/root shape changes
 * — never implies a benchmark-semantics change, and a benchmark-semantics
 * change never implies this needs to bump either (they are orthogonal
 * axes; see README.md's own "Benchmark definition version" section).
 */
export const FORENSIC_TRACE_SCHEMA_VERSION = "1";

/** Redacted+serialized tool-call args must fit within this many characters — these six tools' real schemas (query strings, status enums, refs) are all tiny; generous headroom over any realistic value. Exceeding this fails trace generation explicitly (§ below) rather than silently truncating a forensic fact that may itself be the evidence of a malformed-argument failure. */
export const FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS = 2_000;

/** Redacted final-answer text must fit within this many characters. Generous headroom over MAX_OUTPUT_TOKENS=1024's realistic output length (roughly 4-6K characters for English prose at typical tokens-per-char ratios) — exceeding this is far more likely a scorer-relevant anomaly than legitimate content, and is treated as a fail-closed trace-generation error, never a silent truncation of what may be the single most important forensic fact in the whole artifact. */
export const FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS = 20_000;

/** Whole-file ceiling, measured in UTF-8 BYTES (not JS string .length) after full redaction/serialization. 216 rows x up to MAX_PROVIDER_CALLS_PER_TURN turns x (<=8,000-char tool result + <=20,000-char text) is a theoretical worst case around 36MB; realistic runs are far smaller (most rows are 1-2 turns with small tool results). 50MB leaves comfortable headroom without risking an unbounded file. Exceeding this refuses to write ANY file — never a silently-truncated one. */
export const FORENSIC_TRACE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;

export type ForensicTraceTurn = {
  providerCallIndex: number;
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  responseKind: "text" | "toolCall" | "error" | "protocol_violation";
  responseText?: string;
  toolCall?: { toolName: string; args: unknown };
  toolResult?: { ok: boolean; errorKind: string | null; result: unknown };
  errorClass?: string;
  errorMessage?: string;
};

export type ForensicTraceRow = {
  caseId: string;
  category: BenchmarkCaseCategory;
  repetition: number;
  provider: BenchmarkProviderId;
  modelId: string;
  userPrompt: string;
  turns: ForensicTraceTurn[];
  finalText: string | null;
  finalTextOmittedForBlindness?: true;
  scorerDecision: {
    keyFactsConfirmed: string[];
    keyFactsMissing: string[];
    forbiddenClaimsPresent: string[];
    factualityNeedsHumanReview: boolean;
    mutationCompliant: boolean;
    injectionCompliant: boolean;
    uuidLeaked: boolean;
    fullSequenceMatch: boolean;
    correctFirstTool: boolean | null;
  };
  protocolViolation: boolean;
  errorClass: string | null;
  totalLatencyMs: number;
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  estimatedCostUsd: number;
};

export type ForensicTraceRoot = {
  forensicTraceSchemaVersion: typeof FORENSIC_TRACE_SCHEMA_VERSION;
  benchmarkDefinitionVersion: string;
  gitSha: string;
  generatedAt: string;
  anthropicModelId: string;
  openaiModelId: string;
  repetitionCount: number;
  rowCount: number;
  complete: boolean;
  rows: ForensicTraceRow[];
};

// --- redaction -------------------------------------------------------

/** Recursively applies redactPotentialSecrets() to every string leaf of an arbitrary JSON-shaped value — arrays/objects are walked, non-string primitives pass through unchanged. Never writes a raw value then redacts the serialized form afterward; every leaf is redacted BEFORE it is placed into the structure that gets serialized. */
export function deepRedact(value: unknown): unknown {
  if (typeof value === "string") return redactPotentialSecrets(value);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepRedact(v);
    }
    return out;
  }
  return value; // number | boolean | null | undefined
}

// --- per-run trace collection -----------------------------------------

/**
 * Factory used once per benchmark run (index.ts's own sweep loop): pass
 * `.sink` into runBenchmarkTurn({..., traceSink: sink}); after the run
 * completes, call `.getTurns()` to retrieve the ordered turn list for
 * that run, and `.getCaptureFailure()` to check whether event collection
 * failed at any point. Purely accumulates already-normalized events —
 * never influences loop.ts's own control flow (see TraceSink's own doc
 * comment in result-types.ts). Even if a bug in this collector's own
 * describeTurn()/deepRedact() throws, loop.ts's safeEmitTraceEvent()
 * instrumentation boundary guarantees the throw never escapes past
 * runBenchmarkTurn() — see test/loop-trace-sink-failure-isolation.test.ts.
 *
 * First-failure-wins, then goes quiet: once onCaptureFailure has
 * recorded a failure for this run, onProviderCall/onToolResult become
 * no-ops (never accumulate further, possibly-inconsistent, partial
 * data), and a later, different failure never overwrites the first one
 * recorded. index.ts treats a non-null getCaptureFailure() exactly like
 * a buildForensicTraceRow() failure — the whole run's trace is dropped,
 * never partially written and mislabeled "captured" (see this file's
 * own header comment and index.ts's own sweep-loop wiring).
 */
export function createRunTraceCollector(): { sink: TraceSink; getTurns: () => ForensicTraceTurn[]; getCaptureFailure: () => TraceCaptureFailure | null } {
  const turns: ForensicTraceTurn[] = [];
  let captureFailure: TraceCaptureFailure | null = null;

  function describeTurn(event: TraceProviderCallEvent): ForensicTraceTurn {
    const turn: NormalizedProviderTurn = event.turn;
    const base = { providerCallIndex: event.callIndex, latencyMs: event.latencyMs, usage: event.usage };
    if (turn.kind === "error") {
      return { ...base, responseKind: "error", errorClass: turn.error.kind, errorMessage: redactPotentialSecrets(turn.error.message) };
    }
    if (turn.kind === "protocol_violation") {
      return { ...base, responseKind: "protocol_violation", errorClass: "protocol_violation", errorMessage: redactPotentialSecrets(turn.message) };
    }
    // kind === "ok"
    if (turn.response.kind === "text") {
      return { ...base, responseKind: "text", responseText: redactPotentialSecrets(turn.response.text) };
    }
    // kind === "toolCall" — toolResult (if any) is attached separately by onToolResult, once execution completes.
    return { ...base, responseKind: "toolCall", toolCall: { toolName: turn.response.call.toolName, args: deepRedact(turn.response.call.args) } };
  }

  const sink: TraceSink = {
    onProviderCall(event) {
      if (captureFailure) return; // already failed — stop collecting further events for this run
      turns.push(describeTurn(event));
    },
    onToolResult(event: TraceToolResultEvent) {
      if (captureFailure) return; // already failed — stop collecting further events for this run
      // Tool execution always immediately follows the provider call that
      // requested it, within this same run — attach to the most recently
      // recorded turn (which onProviderCall already pushed for this exact
      // toolCall response).
      const last = turns[turns.length - 1];
      if (last && last.responseKind === "toolCall" && !last.toolResult) {
        last.toolResult = { ok: Boolean((event.result as { ok?: unknown } | null)?.ok), errorKind: (event.result as { error?: string } | null)?.error ?? null, result: deepRedact(event.result) };
      }
    },
    onCaptureFailure(failure) {
      // First-failure-wins: never overwrite an already-recorded failure with a later one.
      if (!captureFailure) captureFailure = failure;
    },
  };

  return { sink, getTurns: () => turns, getCaptureFailure: () => captureFailure };
}

// --- row building (bounded, fail-closed) ------------------------------

export type RowBuildResult = { ok: true; row: ForensicTraceRow } | { ok: false; reason: string };

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Builds one row from already-computed data. Fails EXPLICITLY (never
 * silently truncates) if any bounded field would lose evidence:
 *   - tool-call args exceeding FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS
 *   - final text exceeding FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS
 * Tool RESULTS are not separately bounded here — loop.ts's own
 * MAX_TOOL_RESULT_SERIALIZED_CHARS guard already ensures the trace only
 * ever receives the exact, already-bounded, provider-visible
 * representation (see loop.ts's own toolResultJson() call site) —
 * bounding it again here would either be redundant or, worse, could
 * silently diverge from what the provider actually saw.
 */
export function buildForensicTraceRow(input: {
  caseDef: BenchmarkCase;
  run: RunResult;
  score: CaseScore;
  turns: ForensicTraceTurn[];
}): RowBuildResult {
  const { caseDef, run, score, turns } = input;

  for (const turn of turns) {
    if (turn.toolCall) {
      const serializedArgs = JSON.stringify(turn.toolCall.args) ?? "";
      if (byteLength(serializedArgs) > FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS) {
        return { ok: false, reason: `${caseDef.id}#rep${run.repetition} (${run.provider}): tool-call args for "${turn.toolCall.toolName}" exceed FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS (${FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS}) after redaction.` };
      }
      if (byteLength(JSON.stringify(turn.toolResult?.result ?? null)) > MAX_TOOL_RESULT_SERIALIZED_CHARS * 4) {
        // Generous sanity ceiling far above the real guard, catching only
        // a genuine invariant break (loop.ts's own guard failing to fire)
        // rather than normal operation — see this function's own doc
        // comment for why the real bound is enforced upstream instead.
        return { ok: false, reason: `${caseDef.id}#rep${run.repetition} (${run.provider}): tool result for "${turn.toolCall.toolName}" is implausibly large — loop.ts's own oversized-result guard may not have fired as expected.` };
      }
    }
    if (turn.providerCallIndex >= MAX_PROVIDER_CALLS_PER_TURN) {
      return { ok: false, reason: `${caseDef.id}#rep${run.repetition} (${run.provider}): providerCallIndex ${turn.providerCallIndex} exceeds MAX_PROVIDER_CALLS_PER_TURN (${MAX_PROVIDER_CALLS_PER_TURN}).` };
    }
  }

  const isDrafting = caseDef.category === "drafting";
  let finalText: string | null = null;
  let finalTextOmittedForBlindness: true | undefined;
  const emittedTurns = turns.map((t) => ({ ...t }));

  if (isDrafting) {
    finalTextOmittedForBlindness = true;
    for (const t of emittedTurns) {
      if (t.responseKind === "text") delete t.responseText;
    }
  } else if (run.finalText !== null) {
    const redacted = redactPotentialSecrets(run.finalText);
    if (byteLength(redacted) > FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS) {
      return { ok: false, reason: `${caseDef.id}#rep${run.repetition} (${run.provider}): finalText exceeds FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS (${FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS}) after redaction — refusing to silently truncate potentially the most important forensic evidence in this row.` };
    }
    finalText = redacted;
  }

  return {
    ok: true,
    row: {
      caseId: caseDef.id,
      category: caseDef.category,
      repetition: run.repetition,
      provider: run.provider,
      modelId: run.model,
      userPrompt: redactPotentialSecrets(caseDef.prompt),
      turns: emittedTurns,
      finalText,
      ...(finalTextOmittedForBlindness ? { finalTextOmittedForBlindness } : {}),
      scorerDecision: {
        keyFactsConfirmed: score.keyFactsConfirmed,
        keyFactsMissing: score.keyFactsMissing,
        forbiddenClaimsPresent: score.forbiddenClaimsPresent,
        factualityNeedsHumanReview: score.factualityNeedsHumanReview,
        mutationCompliant: score.mutationCompliant,
        injectionCompliant: score.injectionCompliant,
        uuidLeaked: score.uuidLeaked,
        fullSequenceMatch: score.fullSequenceMatch,
        correctFirstTool: score.correctFirstTool,
      },
      protocolViolation: run.protocolViolation,
      errorClass: run.errorClass,
      totalLatencyMs: run.totalLatencyMs,
      totalUsage: run.totalUsage,
      estimatedCostUsd: run.estimatedCostUsd,
    },
  };
}

// --- root building + validation ----------------------------------------

export type TraceBuildResult = { ok: true; trace: ForensicTraceRoot } | { ok: false; reason: string };

/** Validates an already-built root before write — never rescoring, only structural/shape checks over data scoring.ts already produced. Fails loudly (returns ok:false), never silently drops a row. */
export function validateForensicTraceRoot(trace: ForensicTraceRoot, cases: BenchmarkCase[]): { ok: true } | { ok: false; reason: string } {
  if (trace.forensicTraceSchemaVersion !== FORENSIC_TRACE_SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported forensicTraceSchemaVersion "${trace.forensicTraceSchemaVersion}"` };
  }
  if (!trace.benchmarkDefinitionVersion) return { ok: false, reason: "missing benchmarkDefinitionVersion" };
  if (!/^[0-9a-f]{7,40}$|^unknown/.test(trace.gitSha)) return { ok: false, reason: `gitSha does not look like a git SHA or the documented "unknown" fallback: "${trace.gitSha}"` };
  if (trace.rowCount !== trace.rows.length) return { ok: false, reason: `rowCount (${trace.rowCount}) does not match rows.length (${trace.rows.length})` };

  const caseById = new Map(cases.map((c) => [c.id, c]));

  for (const row of trace.rows) {
    const caseDef = caseById.get(row.caseId);
    if (!caseDef) return { ok: false, reason: `row references unknown caseId "${row.caseId}"` };
    if (row.category !== caseDef.category) return { ok: false, reason: `row for "${row.caseId}" has category "${row.category}", expected "${caseDef.category}"` };
    if (row.repetition < 1 || !Number.isInteger(row.repetition)) return { ok: false, reason: `row for "${row.caseId}" has an invalid repetition (${row.repetition})` };
    if (row.provider !== "anthropic" && row.provider !== "openai") return { ok: false, reason: `row for "${row.caseId}" has an invalid provider "${row.provider}"` };
    if (row.provider === "anthropic" && row.modelId !== trace.anthropicModelId) return { ok: false, reason: `row for "${row.caseId}" (anthropic) modelId mismatch` };
    if (row.provider === "openai" && row.modelId !== trace.openaiModelId) return { ok: false, reason: `row for "${row.caseId}" (openai) modelId mismatch` };
    for (const [k, v] of [
      ["promptTokens", row.totalUsage.promptTokens], ["completionTokens", row.totalUsage.completionTokens], ["totalTokens", row.totalUsage.totalTokens],
    ] as const) {
      if (v < 0 || !Number.isFinite(v)) return { ok: false, reason: `row for "${row.caseId}" has an invalid usage.${k} (${v})` };
    }
    if (row.category === "drafting" && row.finalText !== null) {
      return { ok: false, reason: `row for "${row.caseId}" is category "drafting" but finalText is not null — blindness violation` };
    }
    for (const turn of row.turns) {
      if (!["text", "toolCall", "error", "protocol_violation"].includes(turn.responseKind)) {
        return { ok: false, reason: `row for "${row.caseId}" has an unsupported responseKind "${turn.responseKind}"` };
      }
      if (turn.providerCallIndex >= MAX_PROVIDER_CALLS_PER_TURN) {
        return { ok: false, reason: `row for "${row.caseId}" has providerCallIndex ${turn.providerCallIndex} >= MAX_PROVIDER_CALLS_PER_TURN` };
      }
      if (row.category === "drafting" && turn.responseText !== undefined) {
        return { ok: false, reason: `row for "${row.caseId}" is category "drafting" but a turn still carries responseText — blindness violation` };
      }
    }
  }

  // Defensive re-scan: no raw-SDK/request/header-shaped field name, no
  // reasoning/thinking/internal-shaped field name, anywhere in the
  // serialized structure — a structural guarantee (see this file's own
  // header comment), re-verified here as defense-in-depth.
  const serialized = JSON.stringify(trace);
  const forbiddenFieldPatterns = [/"headers"\s*:/i, /"authorization"\s*:/i, /"apiKey"\s*:/i, /"reasoning(?!Effort)/i, /"thinking"/i, /"_raw/i, /"rawResponse"/i];
  for (const pattern of forbiddenFieldPatterns) {
    if (pattern.test(serialized)) return { ok: false, reason: `serialized trace contains a forbidden field shape matching ${pattern}` };
  }

  return { ok: true };
}

// --- write ----------------------------------------------------------

export type TraceWriteResult = { ok: true; path: string; sha256: string; bytes: number } | { ok: false; reason: string };

/**
 * Fully redact/validate/serialize/size-check BEFORE any write — writes
 * to a temp path (mode 0600) inside outputDir, then atomically renames
 * to forensic-trace.json. On any failure, removes ONLY the temp file
 * this call itself created — never touches results.json/report.md/
 * drafting artifacts or any other file in outputDir.
 */
export function writeForensicTrace(outputDir: string, trace: ForensicTraceRoot, cases: BenchmarkCase[]): TraceWriteResult {
  const validation = validateForensicTraceRoot(trace, cases);
  if (!validation.ok) return { ok: false, reason: validation.reason };

  const serialized = JSON.stringify(trace, null, 2) + "\n";
  const bytes = byteLength(serialized);
  if (bytes > FORENSIC_TRACE_SIZE_LIMIT_BYTES) {
    return { ok: false, reason: `serialized trace is ${bytes} bytes, exceeding FORENSIC_TRACE_SIZE_LIMIT_BYTES (${FORENSIC_TRACE_SIZE_LIMIT_BYTES}) — refusing to write a file this large rather than silently truncating it.` };
  }

  mkdirSync(outputDir, { recursive: true });
  const finalPath = join(outputDir, "forensic-trace.json");
  const tempPath = join(outputDir, ".forensic-trace.json.tmp");
  try {
    writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, finalPath);
  } catch (err) {
    if (existsSync(tempPath)) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // best-effort cleanup only — never throw a second error masking the original write failure
      }
    }
    return { ok: false, reason: `write failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { ok: true, path: finalPath, sha256: createHash("sha256").update(serialized, "utf8").digest("hex"), bytes };
}
