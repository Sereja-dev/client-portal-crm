/**
 * Isolated Aqenra AI provider benchmark harness — forensic-trace.ts
 * comprehensive writer/validator regression (PR 2, task §41).
 *
 * Every row below is built through the REAL end-to-end path a live run
 * would use: cases.ts's own BENCHMARK_CASES -> runBenchmarkTurn() (with a
 * scripted, offline provider — no network) -> scoring.ts's own scoreRun()
 * -> buildForensicTraceRow(). This is deliberate: it proves the trace
 * writer against genuine RunResult/CaseScore shapes, not a hand-rolled
 * stand-in that could silently drift from what index.ts actually passes.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { scoreRun } from "../scoring.js";
import { BENCHMARK_CASES } from "../cases.js";
import { BENCHMARK_DEFINITION_VERSION } from "../benchmark-version.js";
import type { NormalizedProviderTurn, RunResult } from "../result-types.js";
import {
  FORENSIC_TRACE_SCHEMA_VERSION,
  FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS,
  FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS,
  FORENSIC_TRACE_SIZE_LIMIT_BYTES,
  deepRedact,
  createRunTraceCollector,
  buildForensicTraceRow,
  validateForensicTraceRoot,
  writeForensicTrace,
  type ForensicTraceRoot,
  type ForensicTraceRow,
} from "../forensic-trace.js";

const NON_DRAFTING_CASE = BENCHMARK_CASES.find((c) => c.id === "org-summary-01")!;
const DRAFTING_CASE = BENCHMARK_CASES.find((c) => c.category === "drafting")!;
const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function scripted(turns: NormalizedProviderTurn[]): ProviderCompleteFn {
  let cursor = 0;
  return async () => {
    if (cursor >= turns.length) throw new Error("scripted provider: ran out of turns");
    const turn = turns[cursor];
    cursor += 1;
    return turn;
  };
}

/** Runs one full case through the loop with a trace collector attached, scores it, and builds the forensic row — mirrors index.ts's own sweep-loop wiring exactly. */
async function runAndBuildRow(caseDef: typeof NON_DRAFTING_CASE, turns: NormalizedProviderTurn[], overrides: { provider?: "anthropic" | "openai"; model?: string } = {}) {
  const collector = createRunTraceCollector();
  const complete = scripted(turns);
  const run: RunResult = {
    ...(await runBenchmarkTurn({
      provider: overrides.provider ?? "anthropic",
      model: overrides.model ?? "claude-test-model",
      complete,
      userMessage: caseDef.prompt,
      estimateCostUsd: () => 0.0042,
      traceSink: collector.sink,
    })),
    caseId: caseDef.id,
    repetition: 1,
  };
  const score = scoreRun(caseDef, run);
  const rowResult = buildForensicTraceRow({ caseDef, run, score, turns: collector.getTurns() });
  return { run, score, rowResult };
}

function rootFor(rows: ForensicTraceRow[], overrides: Partial<ForensicTraceRoot> = {}): ForensicTraceRoot {
  return {
    forensicTraceSchemaVersion: FORENSIC_TRACE_SCHEMA_VERSION,
    benchmarkDefinitionVersion: BENCHMARK_DEFINITION_VERSION,
    gitSha: "abc1234",
    generatedAt: "2026-01-01T00:00:00.000Z",
    anthropicModelId: "claude-test-model",
    openaiModelId: "gpt-test-model",
    repetitionCount: 1,
    rowCount: rows.length,
    complete: true,
    rows,
    ...overrides,
  };
}

describe("forensic-trace.ts — row building against a real (non-drafting) case", () => {
  test("retains the exact finalText, tool args, and tool result the loop actually produced", async () => {
    const { rowResult, run } = await runAndBuildRow(NON_DRAFTING_CASE, [
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: "Cobalt" } }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: "There are 2 matching clients.", usage: USAGE } },
    ]);
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;
    const row = rowResult.row;

    assert.equal(row.finalText, "There are 2 matching clients.");
    assert.equal(row.finalTextOmittedForBlindness, undefined);
    assert.equal(row.turns.length, 2);
    assert.equal(row.turns[0].responseKind, "toolCall");
    assert.deepEqual(row.turns[0].toolCall, { toolName: "searchClients", args: { query: "Cobalt" } });
    assert.equal(row.turns[1].responseKind, "text");
    assert.equal(row.turns[1].responseText, "There are 2 matching clients.");

    // The tool result the trace captured must be the EXACT provider-visible
    // representation the loop actually fed back to the model — reconstruct
    // that same value independently from the run's own toolCalls trace and
    // require byte-for-byte structural equality.
    assert.ok(row.turns[0].toolResult, "expected a toolResult to be attached to the toolCall turn");
    assert.equal(row.turns[0].toolResult!.ok, run.toolCalls[0].resultOk);
  });

  test("providerCallIndex is ascending and matches call order across multiple turns", async () => {
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: {} }, usage: USAGE } },
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchProjects", args: {} }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: "Done.", usage: USAGE } },
    ]);
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;
    assert.deepEqual(rowResult.row.turns.map((t) => t.providerCallIndex), [0, 1, 2]);
  });

  test("a normalized provider error is retained safely: errorClass + message, never a raw error object or stack", async () => {
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [{ kind: "error", error: { kind: "rate_limited", message: "429 from vendor" } }]);
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;
    const turn = rowResult.row.turns[0];
    assert.equal(turn.responseKind, "error");
    assert.equal(turn.errorClass, "rate_limited");
    assert.equal(turn.errorMessage, "429 from vendor");
    assert.equal("stack" in turn, false);
    assert.equal(JSON.stringify(turn).includes("Authorization"), false);
  });

  test("a protocol_violation turn is retained as such, never silently reclassified", async () => {
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [
      { kind: "protocol_violation", message: "vendor returned 2 tool calls", rawToolCalls: [{ toolName: "searchClients", args: {} }, { toolName: "searchProjects", args: {} }] },
    ]);
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;
    assert.equal(rowResult.row.turns[0].responseKind, "protocol_violation");
    assert.equal(rowResult.row.protocolViolation, true);
  });

  test("scorerDecision is populated ONLY from the already-computed CaseScore, never rescored independently", async () => {
    const { rowResult, score } = await runAndBuildRow(NON_DRAFTING_CASE, [
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: {} }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: "There are some clients.", usage: USAGE } },
    ]);
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;
    assert.deepEqual(rowResult.row.scorerDecision, {
      keyFactsConfirmed: score.keyFactsConfirmed,
      keyFactsMissing: score.keyFactsMissing,
      forbiddenClaimsPresent: score.forbiddenClaimsPresent,
      factualityNeedsHumanReview: score.factualityNeedsHumanReview,
      mutationCompliant: score.mutationCompliant,
      injectionCompliant: score.injectionCompliant,
      uuidLeaked: score.uuidLeaked,
      fullSequenceMatch: score.fullSequenceMatch,
      correctFirstTool: score.correctFirstTool,
    });
  });
});

describe("forensic-trace.ts — drafting blindness (row building)", () => {
  test("finalText is null + finalTextOmittedForBlindness is set for a drafting-category row, even though the model DID produce visible text", async () => {
    const DISTINCTIVE_DRAFT = "Dear Cobalt & Finch, per our records the Brand Discovery engagement remains on schedule — DISTINCTIVE_DRAFT_MARKER_9f3a.";
    const { rowResult } = await runAndBuildRow(DRAFTING_CASE, [{ kind: "ok", response: { kind: "text", text: DISTINCTIVE_DRAFT, usage: USAGE } }]);
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;
    const row = rowResult.row;
    assert.equal(row.finalText, null);
    assert.equal(row.finalTextOmittedForBlindness, true);
    assert.equal(row.turns[0].responseText, undefined);

    // The distinctive drafted answer must appear NOWHERE in the serialized row.
    assert.equal(JSON.stringify(row).includes("DISTINCTIVE_DRAFT_MARKER_9f3a"), false);
  });

  test("a drafting row that also used a tool keeps the tool call/result (identity), but still omits any text turn", async () => {
    const { rowResult } = await runAndBuildRow(DRAFTING_CASE, [
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchProjects", args: { status: "active" } }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: "Draft: hello Cobalt & Finch, SECRET_DRAFT_XYZ.", usage: USAGE } },
    ]);
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;
    const row = rowResult.row;
    assert.deepEqual(row.turns[0].toolCall, { toolName: "searchProjects", args: { status: "active" } });
    assert.equal(row.turns[1].responseText, undefined);
    assert.equal(JSON.stringify(row).includes("SECRET_DRAFT_XYZ"), false);
  });
});

describe("forensic-trace.ts — fail-closed size bounds (row building)", () => {
  test("tool-call args exceeding FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS fails the row explicitly, never truncates", async () => {
    const oversizedArgs = { query: "x".repeat(FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS + 500) };
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: oversizedArgs }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: "done", usage: USAGE } },
    ]);
    assert.equal(rowResult.ok, false);
    if (rowResult.ok) return;
    assert.match(rowResult.reason, /FORENSIC_TRACE_TOOL_ARGS_MAX_CHARS/);
  });

  test("finalText exceeding FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS fails the row explicitly, never truncates", async () => {
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [
      { kind: "ok", response: { kind: "text", text: "y".repeat(FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS + 1000), usage: USAGE } },
    ]);
    assert.equal(rowResult.ok, false);
    if (rowResult.ok) return;
    assert.match(rowResult.reason, /FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS/);
  });

  test("a drafting row's finalText is exempt from the finalText size bound, since the text itself is never persisted", async () => {
    const { rowResult } = await runAndBuildRow(DRAFTING_CASE, [
      { kind: "ok", response: { kind: "text", text: "z".repeat(FORENSIC_TRACE_FINAL_TEXT_MAX_CHARS + 1000), usage: USAGE } },
    ]);
    assert.equal(rowResult.ok, true);
  });
});

describe("forensic-trace.ts — deepRedact()", () => {
  test("redacts a live secret value at any nesting depth in an arbitrary object/array", () => {
    process.env.AQENRA_EVAL_ANTHROPIC_API_KEY = "sk-ant-deep-redact-test-value";
    try {
      const input = { a: ["ok", { b: "sk-ant-deep-redact-test-value" }], c: 42, d: null, e: undefined };
      const out = deepRedact(input) as Record<string, unknown>;
      assert.equal(JSON.stringify(out).includes("deep-redact-test-value"), false);
      assert.equal(out.c, 42);
      assert.equal(out.d, null);
    } finally {
      delete process.env.AQENRA_EVAL_ANTHROPIC_API_KEY;
    }
  });

  test("passes non-string primitives through unchanged", () => {
    assert.equal(deepRedact(42), 42);
    assert.equal(deepRedact(true), true);
    assert.equal(deepRedact(null), null);
  });
});

describe("forensic-trace.ts — validateForensicTraceRoot()", () => {
  test("accepts a well-formed root built from real rows", async () => {
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [{ kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } }]);
    assert.equal(rowResult.ok, true);
    if (!rowResult.ok) return;
    const root = rootFor([rowResult.row]);
    assert.deepEqual(validateForensicTraceRoot(root, BENCHMARK_CASES), { ok: true });
  });

  test("rejects an unsupported forensicTraceSchemaVersion", async () => {
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [{ kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } }]);
    if (!rowResult.ok) return;
    const root = rootFor([rowResult.row], { forensicTraceSchemaVersion: "999" as unknown as typeof FORENSIC_TRACE_SCHEMA_VERSION });
    const result = validateForensicTraceRoot(root, BENCHMARK_CASES);
    assert.equal(result.ok, false);
  });

  test("rejects a row referencing an unknown caseId", () => {
    const root = rootFor([{ ...blankRow(), caseId: "does-not-exist" }]);
    const result = validateForensicTraceRoot(root, BENCHMARK_CASES);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /unknown caseId/);
  });

  test("rejects a row whose category doesn't match its case definition", () => {
    const root = rootFor([{ ...blankRow(), caseId: NON_DRAFTING_CASE.id, category: "drafting" }]);
    const result = validateForensicTraceRoot(root, BENCHMARK_CASES);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /category/);
  });

  test("rejects a provider/model mismatch (anthropic row carrying the openai model id)", () => {
    const root = rootFor([{ ...blankRow(), caseId: NON_DRAFTING_CASE.id, category: NON_DRAFTING_CASE.category, provider: "anthropic", modelId: "gpt-test-model" }]);
    const result = validateForensicTraceRoot(root, BENCHMARK_CASES);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /modelId mismatch/);
  });

  test("rejects a drafting row that still carries a non-null finalText (blindness violation, defense-in-depth)", () => {
    const draftingCase = BENCHMARK_CASES.find((c) => c.category === "drafting")!;
    const root = rootFor([{ ...blankRow(), caseId: draftingCase.id, category: "drafting", finalText: "leaked draft text" }]);
    const result = validateForensicTraceRoot(root, BENCHMARK_CASES);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /blindness/);
  });

  test("rejects a row whose turn carries a forbidden raw-SDK/reasoning-shaped field, even though the type system wouldn't normally allow it (defense-in-depth)", () => {
    const row = blankRow();
    row.turns = [{ providerCallIndex: 0, latencyMs: 1, usage: null, responseKind: "text", responseText: "ok" } as ForensicTraceRow["turns"][number]];
    const contaminated = { ...row, __injected: { reasoning: "some hidden chain of thought" } } as unknown as ForensicTraceRow;
    const root = rootFor([contaminated]);
    const result = validateForensicTraceRoot(root, BENCHMARK_CASES);
    assert.equal(result.ok, false);
  });

  function blankRow(): ForensicTraceRow {
    return {
      caseId: NON_DRAFTING_CASE.id,
      category: NON_DRAFTING_CASE.category,
      repetition: 1,
      provider: "anthropic",
      modelId: "claude-test-model",
      userPrompt: NON_DRAFTING_CASE.prompt,
      turns: [],
      finalText: null,
      scorerDecision: {
        keyFactsConfirmed: [], keyFactsMissing: [], forbiddenClaimsPresent: [], factualityNeedsHumanReview: false,
        mutationCompliant: true, injectionCompliant: true, uuidLeaked: false, fullSequenceMatch: true, correctFirstTool: null,
      },
      protocolViolation: false,
      errorClass: null,
      totalLatencyMs: 1,
      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
    };
  }
});

describe("forensic-trace.ts — writeForensicTrace() atomicity, permissions, and size ceiling", () => {
  test("writes a 0600-mode file atomically and leaves no temp file behind", async () => {
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [{ kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } }]);
    if (!rowResult.ok) throw new Error("row build failed unexpectedly");
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-forensic-trace-write-test-"));
    try {
      const root = rootFor([rowResult.row]);
      const result = writeForensicTrace(tempDir, root, BENCHMARK_CASES);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(existsSync(join(tempDir, ".forensic-trace.json.tmp")), false, "temp file must not remain after a successful write");
      assert.equal(existsSync(result.path), true);

      const mode = statSync(result.path).mode & 0o777;
      assert.equal(mode, 0o600, `expected mode 0600, got ${mode.toString(8)}`);

      const written = JSON.parse(readFileSync(result.path, "utf8")) as ForensicTraceRoot;
      assert.deepEqual(written, root);

      // sha256 recorded in the write result matches the actual file bytes.
      const bytes = Buffer.byteLength(readFileSync(result.path, "utf8"), "utf8");
      assert.equal(bytes, result.bytes);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("refuses to write a file whose serialized size exceeds FORENSIC_TRACE_SIZE_LIMIT_BYTES — never a silently truncated file", () => {
    // Build many oversized-but-individually-valid rows directly (bypassing
    // buildForensicTraceRow's own per-field caps, which this test isn't
    // exercising) so their COMBINED serialized size exceeds the whole-file
    // ceiling.
    const bigText = "L".repeat(19_000);
    const rows: ForensicTraceRow[] = Array.from({ length: 3000 }, (_, i) => ({
      caseId: NON_DRAFTING_CASE.id,
      category: NON_DRAFTING_CASE.category,
      repetition: i + 1,
      provider: "anthropic",
      modelId: "claude-test-model",
      userPrompt: NON_DRAFTING_CASE.prompt,
      turns: [],
      finalText: bigText,
      scorerDecision: {
        keyFactsConfirmed: [], keyFactsMissing: [], forbiddenClaimsPresent: [], factualityNeedsHumanReview: false,
        mutationCompliant: true, injectionCompliant: true, uuidLeaked: false, fullSequenceMatch: true, correctFirstTool: null,
      },
      protocolViolation: false,
      errorClass: null,
      totalLatencyMs: 1,
      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
    }));
    const root = rootFor(rows);
    // Sanity: this really does exceed the ceiling before we even call the writer.
    assert.ok(Buffer.byteLength(JSON.stringify(root), "utf8") > FORENSIC_TRACE_SIZE_LIMIT_BYTES);

    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-forensic-trace-oversize-test-"));
    try {
      const result = writeForensicTrace(tempDir, root, BENCHMARK_CASES);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /FORENSIC_TRACE_SIZE_LIMIT_BYTES/);
      assert.equal(existsSync(join(tempDir, "forensic-trace.json")), false, "no file must be written when oversized");
      assert.equal(existsSync(join(tempDir, ".forensic-trace.json.tmp")), false, "no temp file must be left behind either");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("refuses to write (and never touches results.json/report.md/other artifacts) when validation fails", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-forensic-trace-invalid-test-"));
    try {
      // Place sentinel "other artifacts" that must survive untouched.
      const sentinelPath = join(tempDir, "results.json");
      const sentinelContent = '{"sentinel":true}';
      writeFileSync(sentinelPath, sentinelContent, "utf8");

      const invalidRoot = rootFor([], { rowCount: 5 }); // rowCount/rows.length mismatch -> invalid
      const result = writeForensicTrace(tempDir, invalidRoot, BENCHMARK_CASES);
      assert.equal(result.ok, false);
      assert.equal(existsSync(join(tempDir, "forensic-trace.json")), false);
      assert.equal(existsSync(join(tempDir, ".forensic-trace.json.tmp")), false);
      assert.equal(readFileSync(sentinelPath, "utf8"), sentinelContent, "an unrelated artifact in the same directory must be untouched");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("cleans up ONLY its own owned temp file when the atomic rename itself fails, and never touches a pre-existing file/directory at the final path", async () => {
    const { rowResult } = await runAndBuildRow(NON_DRAFTING_CASE, [{ kind: "ok", response: { kind: "text", text: "hi", usage: USAGE } }]);
    if (!rowResult.ok) throw new Error("row build failed unexpectedly");
    const tempDir = mkdtempSync(join(tmpdir(), "aqenra-forensic-trace-rename-fail-test-"));
    try {
      // Force the rename to fail: make the FINAL path already exist as a
      // non-empty directory (renaming a file onto an existing directory
      // fails on every common filesystem).
      const finalPath = join(tempDir, "forensic-trace.json");
      mkdirSync(finalPath);
      mkdirSync(join(finalPath, "occupied"));

      const root = rootFor([rowResult.row]);
      const result = writeForensicTrace(tempDir, root, BENCHMARK_CASES);
      assert.equal(result.ok, false);

      assert.equal(existsSync(join(tempDir, ".forensic-trace.json.tmp")), false, "the owned temp file must be cleaned up after a failed rename");
      assert.equal(statSync(finalPath).isDirectory(), true, "the pre-existing directory at the final path must be untouched");
      assert.equal(existsSync(join(finalPath, "occupied")), true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
