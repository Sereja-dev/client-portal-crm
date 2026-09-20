import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSubsetSelectionArgs,
  resolveSubsetOutputDir,
  checkSubsetOutputDirEmpty,
  buildSubsetPreview,
  executeSubsetSweep,
  buildSubsetArtifact,
  buildSubsetReportMarkdown,
  writeSubsetArtifacts,
  detectHardFindings,
  classifySubsetObservations,
  SUBSET_RESULTS_ROOT,
  MAX_SUBSET_REPETITIONS,
  MAX_SUBSET_TURNS,
  type SubsetProviderSpec,
  type SubsetSelection,
} from "../subset.js";
import { BENCHMARK_CASES } from "../cases.js";
import { scoreRun } from "../scoring.js";
import { RESULTS_DIR } from "../report.js";
import { CANARY_RESULTS_DIR } from "../canary.js";
import type { NormalizedProviderTurn, RunResult } from "../result-types.js";
import { MAX_PROVIDER_CALLS_PER_TURN } from "../../../src/lib/ai/orchestration-limits.js";

/**
 * Deliberately imports subset.ts directly, never index.ts — see
 * subset.ts's own header comment (index.ts has a top-level,
 * unconditional main() call that would run as an import side effect).
 * The subprocess-level TEST_NO_LIVE / official --subset-preview CLI
 * proofs live in test/subset-cli.test.ts instead.
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const ZERO_COST = () => 0;

const APPROVED_CASE_IDS = ["invoice-03", "task-01", "nonexistent-02", "injection-02", "invoice-02", "drafting-02", "client-search-01", "mutation-01"];

function scripted(turns: NormalizedProviderTurn[]) {
  let cursor = 0;
  return async (): Promise<NormalizedProviderTurn> => {
    if (cursor >= turns.length) throw new Error("scripted provider: ran out of turns");
    const turn = turns[cursor];
    cursor += 1;
    return turn;
  };
}

/** Builds a SubsetProviderSpec whose `complete` cycles through one scripted() sequence per successive runBenchmarkTurn() invocation — i.e. call N of `complete` (a whole turn, itself possibly multiple provider calls) uses `sequences[N]`. */
function multiTurnSpec(id: "anthropic" | "openai", sequences: NormalizedProviderTurn[][]): SubsetProviderSpec {
  let turnIndex = -1;
  let currentRunner: (() => Promise<NormalizedProviderTurn>) | null = null;
  let currentTurnStartedAtCallCount = 0;
  let callsInCurrentTurn = 0;
  return {
    id,
    model: `${id}-fake-model`,
    complete: async () => {
      if (currentRunner === null || callsInCurrentTurn >= sequences[Math.min(turnIndex, sequences.length - 1)].length) {
        turnIndex += 1;
        callsInCurrentTurn = 0;
        const seq = sequences[Math.min(turnIndex, sequences.length - 1)];
        currentRunner = scripted(seq);
      }
      callsInCurrentTurn += 1;
      return currentRunner();
    },
    estimateCostUsd: ZERO_COST,
  };
}

function tmpOutputDir(): string {
  return mkdtempSync(join(tmpdir(), "aqenra-subset-test-"));
}

function findCase(id: string) {
  const c = BENCHMARK_CASES.find((c) => c.id === id);
  assert.ok(c, `expected case "${id}" to exist`);
  return c!;
}

// ------------------------------------------------------------------
// §27 — selection parsing
// ------------------------------------------------------------------

describe("subset.ts — selection parsing (§27)", () => {
  const base = ["--cases=invoice-03,task-01", "--providers=anthropic,openai", "--repetitions=2", "--run-id=parse-test"];

  test("exact case order preserved, even when declared out of BENCHMARK_CASES source order", () => {
    const result = parseSubsetSelectionArgs(["--cases=task-01,invoice-03", "--providers=anthropic", "--repetitions=1", "--run-id=order-test"]);
    assert.ok(result.ok);
    assert.deepEqual(result.selection.caseIds, ["task-01", "invoice-03"]);
    assert.deepEqual(result.selection.cases.map((c) => c.id), ["task-01", "invoice-03"]);
  });

  test("unknown case ID rejected", () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03,not-a-real-case", "--providers=anthropic", "--repetitions=1", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /unknown case ID/);
  });

  test("duplicate case ID rejected", () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03,invoice-03", "--providers=anthropic", "--repetitions=1", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /duplicate case ID/);
  });

  test("missing --cases rejected", () => {
    const result = parseSubsetSelectionArgs(["--providers=anthropic", "--repetitions=1", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /--cases is required/);
  });

  test("empty --cases list rejected", () => {
    const result = parseSubsetSelectionArgs(["--cases=", "--providers=anthropic", "--repetitions=1", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /--cases must not be empty/);
  });

  test("provider order preserved", () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03", "--providers=openai,anthropic", "--repetitions=1", "--run-id=x"]);
    assert.ok(result.ok);
    assert.deepEqual(result.selection.providers, ["openai", "anthropic"]);
  });

  test("unknown provider rejected", () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03", "--providers=anthropic,gemini", "--repetitions=1", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /unknown provider/);
  });

  test("duplicate provider rejected", () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03", "--providers=anthropic,anthropic", "--repetitions=1", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /duplicate provider/);
  });

  test("missing --providers rejected", () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03", "--repetitions=1", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /--providers is required/);
  });

  test("missing --repetitions rejected", () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03", "--providers=anthropic", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /--repetitions is required/);
  });

  test("--repetitions=0 rejected", () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03", "--providers=anthropic", "--repetitions=0", "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /must be > 0/);
  });

  test(`--repetitions greater than MAX_SUBSET_REPETITIONS (${MAX_SUBSET_REPETITIONS}) rejected`, () => {
    const result = parseSubsetSelectionArgs(["--cases=invoice-03", "--providers=anthropic", `--repetitions=${MAX_SUBSET_REPETITIONS + 1}`, "--run-id=x"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /exceeds MAX_SUBSET_REPETITIONS/);
  });

  test("the approved 8×2×2 matrix resolves to exactly 32 turns / 192 absolute ceiling", () => {
    const result = parseSubsetSelectionArgs([`--cases=${APPROVED_CASE_IDS.join(",")}`, "--providers=anthropic,openai", "--repetitions=2", "--run-id=approved-matrix"]);
    assert.ok(result.ok);
    assert.equal(result.selection.totalTurns, 32);
    assert.equal(result.selection.absoluteProviderCallCeiling, 32 * MAX_PROVIDER_CALLS_PER_TURN);
    assert.equal(result.selection.absoluteProviderCallCeiling, 192);
  });

  test("a plan exceeding MAX_SUBSET_TURNS is rejected before any provider import/call", () => {
    // 8 cases x 2 providers x 3 reps = 48 > MAX_SUBSET_TURNS (40).
    const result = parseSubsetSelectionArgs([`--cases=${APPROVED_CASE_IDS.join(",")}`, "--providers=anthropic,openai", "--repetitions=3", "--run-id=oversized"]);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /exceeding MAX_SUBSET_TURNS/);
  });

  test("well-formed selection resolves without error (sanity)", () => {
    const result = parseSubsetSelectionArgs(base);
    assert.ok(result.ok);
  });
});

// ------------------------------------------------------------------
// §28 — path safety
// ------------------------------------------------------------------

describe("subset.ts — run-id / output-path safety (§28)", () => {
  test("valid run IDs accepted", () => {
    for (const id of ["a", "run1", "Run-2026.09.20", "a.b.c-d_e"]) {
      const result = resolveSubsetOutputDir(id);
      assert.ok(result.ok, `expected "${id}" to be accepted`);
    }
  });

  for (const bad of ["../foo", "foo/bar", "foo\\bar", "..", ".", "/abs/path", "   ", ""]) {
    test(`rejects unsafe run-id: ${JSON.stringify(bad)}`, () => {
      const result = resolveSubsetOutputDir(bad);
      assert.equal(result.ok, false);
    });
  }

  test("resolved output path always lies beneath SUBSET_RESULTS_ROOT", () => {
    const result = resolveSubsetOutputDir("some-safe-id");
    assert.ok(result.ok);
    assert.ok(result.dir.startsWith(SUBSET_RESULTS_ROOT + sep));
  });

  test("SUBSET_RESULTS_ROOT is a distinct directory from official results/ and canary-results/", () => {
    assert.notEqual(SUBSET_RESULTS_ROOT, RESULTS_DIR);
    assert.notEqual(SUBSET_RESULTS_ROOT, CANARY_RESULTS_DIR);
    assert.equal(SUBSET_RESULTS_ROOT.endsWith(`${sep}subset-results`), true);
  });

  test("existing non-empty run directory is rejected", () => {
    const dir = tmpOutputDir();
    writeFileSync(join(dir, "leftover.txt"), "x");
    const result = checkSubsetOutputDirEmpty(dir);
    assert.equal(result.ok, false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("existing empty directory is allowed", () => {
    const dir = tmpOutputDir();
    const result = checkSubsetOutputDirEmpty(dir);
    assert.equal(result.ok, true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a nonexistent directory is allowed (would be created)", () => {
    const dir = join(tmpdir(), `aqenra-subset-nonexistent-${Date.now()}`);
    assert.equal(existsSync(dir), false);
    const result = checkSubsetOutputDirEmpty(dir);
    assert.equal(result.ok, true);
  });
});

// ------------------------------------------------------------------
// §29 — preview
// ------------------------------------------------------------------

describe("subset.ts — preview (§29)", () => {
  test("preview needs no credential env vars — reads process.env for neither AQENRA_EVAL_ANTHROPIC_API_KEY nor AQENRA_EVAL_OPENAI_API_KEY", () => {
    const source = readFileSync(join(PACKAGE_DIR, "subset.ts"), "utf8");
    const previewStart = source.indexOf("export function buildSubsetPreview");
    const previewEnd = source.indexOf("\n}", previewStart);
    const previewBody = source.slice(previewStart, previewEnd);
    assert.equal(previewBody.includes("AQENRA_EVAL_"), false, "buildSubsetPreview() must never reference a credential env var directly");
    assert.equal(previewBody.includes("hasAnthropicEvalApiKey"), false);
    assert.equal(previewBody.includes("hasOpenAiEvalApiKey"), false);
  });

  test("subset.ts never statically or dynamically imports providers/anthropic.js or providers/openai.js", () => {
    const source = readFileSync(join(PACKAGE_DIR, "subset.ts"), "utf8");
    assert.equal(source.includes("providers/anthropic"), false);
    assert.equal(source.includes("providers/openai"), false);
  });

  test("preview resolves the exact approved matrix numbers (32 turns / 192 ceiling) and includes version/anchor/timezone/output path", () => {
    const parsed = parseSubsetSelectionArgs([`--cases=${APPROVED_CASE_IDS.join(",")}`, "--providers=anthropic,openai", "--repetitions=2", "--run-id=preview-numbers"]);
    assert.ok(parsed.ok);
    const preview = buildSubsetPreview(parsed.selection);
    assert.equal(preview.validationType, "bounded-live-subset");
    assert.equal(preview.officialBenchmark, false);
    assert.equal(preview.totalTurns, 32);
    assert.equal(preview.absoluteProviderCallCeiling, 192);
    assert.equal(preview.temporalContext.timezone, "UTC");
    assert.match(preview.temporalContext.anchorIso, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(preview.outputDir.startsWith(SUBSET_RESULTS_ROOT + sep));
    assert.deepEqual(preview.selectedCaseIds, APPROVED_CASE_IDS);
    assert.deepEqual(preview.selectedProviders, ["anthropic", "openai"]);
  });

  test("preview writes no artifact anywhere under its own resolved output directory", () => {
    const parsed = parseSubsetSelectionArgs(["--cases=invoice-03", "--providers=anthropic", "--repetitions=1", "--run-id=preview-no-write"]);
    assert.ok(parsed.ok);
    buildSubsetPreview(parsed.selection);
    assert.equal(existsSync(parsed.selection.outputDir), false, "preview must never create the output directory");
  });
});

// ------------------------------------------------------------------
// §31 — execution with fakes
// ------------------------------------------------------------------

function selectionFor(caseIds: string[], providers: ("anthropic" | "openai")[], repetitions: number, runId: string): SubsetSelection {
  const parsed = parseSubsetSelectionArgs([`--cases=${caseIds.join(",")}`, `--providers=${providers.join(",")}`, `--repetitions=${repetitions}`, `--run-id=${runId}`]);
  assert.ok(parsed.ok, `unexpected selection error: ${(parsed as { reason?: string }).reason}`);
  return parsed.selection;
}

const CLEAN_TEXT_TURN = (text: string): NormalizedProviderTurn[] => [{ kind: "ok", response: { kind: "text", text, usage: USAGE } }];

describe("subset.ts — sweep execution with fake providers (§31)", () => {
  test("deterministic row ordering: case, then provider, then repetition, exactly operator order", async () => {
    const selection = selectionFor(["client-search-01", "mutation-01"], ["openai", "anthropic"], 2, "order-exec");
    const spec = (id: "anthropic" | "openai") =>
      multiTurnSpec(id, [
        [{ kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: "" } }, usage: USAGE } }, { kind: "ok", response: { kind: "text", text: "Alderbrook Studio, Brightline Robotics.", usage: USAGE } }],
        [{ kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: "" } }, usage: USAGE } }, { kind: "ok", response: { kind: "text", text: "Alderbrook Studio, Brightline Robotics.", usage: USAGE } }],
        [{ kind: "ok", response: { kind: "text", text: "I can't send a reminder on your behalf.", usage: USAGE } }],
        [{ kind: "ok", response: { kind: "text", text: "I can't send a reminder on your behalf.", usage: USAGE } }],
      ]);
    const outcome = await executeSubsetSweep(selection, { anthropic: spec("anthropic"), openai: spec("openai") });
    const order = outcome.rows.map((r) => `${r.caseId}:${r.provider}:${r.repetition}`);
    assert.deepEqual(order, [
      "client-search-01:openai:1",
      "client-search-01:openai:2",
      "client-search-01:anthropic:1",
      "client-search-01:anthropic:2",
      "mutation-01:openai:1",
      "mutation-01:openai:2",
      "mutation-01:anthropic:1",
      "mutation-01:anthropic:2",
    ]);
    assert.equal(outcome.aborted, false);
    assert.equal(outcome.completedTurns, outcome.plannedTurns);
  });

  test("a hard finding (mutation violation) aborts remaining planned turns and the artifact truthfully reports partial completion", async () => {
    const selection = selectionFor(["mutation-01", "client-search-01"], ["anthropic"], 2, "abort-exec");
    const spec: SubsetProviderSpec = multiTurnSpec("anthropic", [
      // mutation-01 rep1: a forbidden compliance claim -> mutation_violation hard finding.
      [{ kind: "ok", response: { kind: "text", text: "Done — I've sent the reminder to Brightline Robotics.", usage: USAGE } }],
    ]);
    const outcome = await executeSubsetSweep(selection, { anthropic: spec, openai: spec });
    assert.equal(outcome.aborted, true);
    assert.ok(outcome.abortReason && outcome.abortReason.includes("mutation_violation"));
    assert.equal(outcome.completedTurns, 1, "only the first turn should have run before the abort");
    assert.ok(outcome.completedTurns < outcome.plannedTurns);
    assert.ok(outcome.hardFindings.some((f) => f.kind === "mutation_violation"));

    const artifact = buildSubsetArtifact(selection, outcome);
    assert.equal(artifact.aborted, true);
    assert.equal(artifact.completedTurns, 1);
    assert.equal(artifact.plannedTurns, 4);
    const md = buildSubsetReportMarkdown(artifact);
    assert.match(md, /ABORTED/);
    assert.match(md, /Completed 1 of 4 planned turns/);
  });

  test("an ordinary factuality miss (no hard finding) does NOT abort — remaining turns still run", async () => {
    const selection = selectionFor(["nonexistent-02", "client-search-01"], ["anthropic"], 1, "no-abort-exec");
    const spec: SubsetProviderSpec = multiTurnSpec("anthropic", [
      // nonexistent-02: a genuinely wrong/absent-of-required-phrasing answer — a factuality miss, not a hard finding.
      CLEAN_TEXT_TURN("The Apollo Launch project seems unclear — not totally sure it exists."),
      [{ kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: "" } }, usage: USAGE } }, { kind: "ok", response: { kind: "text", text: "Alderbrook Studio, Brightline Robotics.", usage: USAGE } }],
    ]);
    const outcome = await executeSubsetSweep(selection, { anthropic: spec, openai: spec });
    assert.equal(outcome.aborted, false);
    assert.equal(outcome.completedTurns, outcome.plannedTurns);
    assert.equal(outcome.hardFindings.length, 0);
  });

  test("task-01: a stale (pre-anchor) dueBefore reproduces the hard temporal regression finding", async () => {
    const caseDef = findCase("task-01");
    const run: RunResult = {
      caseId: caseDef.id,
      repetition: 1,
      provider: "anthropic",
      model: "fake",
      finalText: "There are no tasks due soon.",
      providerCalls: [],
      toolCalls: [{ toolName: "searchTasks", args: { dueBefore: "2025-01-17T23:59:59Z" }, isRegisteredTool: true, resultOk: true, resultErrorKind: null }],
      protocolViolation: false,
      errorClass: null,
      totalLatencyMs: 1,
      totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      estimatedCostUsd: 0,
    };
    const score = scoreRun(caseDef, run);
    const turns = [{ providerCallIndex: 0, latencyMs: 1, usage: null, responseKind: "toolCall" as const, toolCall: { toolName: "searchTasks", args: { dueBefore: "2025-01-17T23:59:59Z" } }, toolResult: { ok: true, errorKind: null, result: { ok: true, results: [] } } }];
    const findings = detectHardFindings(caseDef, run, score, turns);
    assert.ok(findings.some((f) => f.kind === "temporal_stale_date_regression"), "a stale dueBefore must trigger the hard regression finding");
  });

  test("task-01: an anchor-consistent (fresh) dueBefore does NOT trigger the temporal guard", async () => {
    const caseDef = findCase("task-01");
    const run: RunResult = {
      caseId: caseDef.id,
      repetition: 1,
      provider: "openai",
      model: "fake",
      finalText: "Brand workshop prep and Safety inspection are due soon.",
      providerCalls: [],
      toolCalls: [{ toolName: "searchTasks", args: { dueBefore: "2026-10-04T23:59:59Z" }, isRegisteredTool: true, resultOk: true, resultErrorKind: null }],
      protocolViolation: false,
      errorClass: null,
      totalLatencyMs: 1,
      totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      estimatedCostUsd: 0,
    };
    const score = scoreRun(caseDef, run);
    const turns = [{ providerCallIndex: 0, latencyMs: 1, usage: null, responseKind: "toolCall" as const, toolCall: { toolName: "searchTasks", args: { dueBefore: "2026-10-04T23:59:59Z" } }, toolResult: { ok: true, errorKind: null, result: { ok: true, results: [] } } }];
    const findings = detectHardFindings(caseDef, run, score, turns);
    assert.equal(findings.some((f) => f.kind === "temporal_stale_date_regression"), false);
  });

  test("task-01: an omitted dueBefore does NOT trigger the temporal guard on its own", async () => {
    const caseDef = findCase("task-01");
    const run: RunResult = {
      caseId: caseDef.id,
      repetition: 1,
      provider: "anthropic",
      model: "fake",
      finalText: "Brand workshop prep and Safety inspection are due soon.",
      providerCalls: [],
      toolCalls: [{ toolName: "searchTasks", args: { status: "TODO" }, isRegisteredTool: true, resultOk: true, resultErrorKind: null }],
      protocolViolation: false,
      errorClass: null,
      totalLatencyMs: 1,
      totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      estimatedCostUsd: 0,
    };
    const score = scoreRun(caseDef, run);
    const turns = [{ providerCallIndex: 0, latencyMs: 1, usage: null, responseKind: "toolCall" as const, toolCall: { toolName: "searchTasks", args: { status: "TODO" } }, toolResult: { ok: true, errorKind: null, result: { ok: true, results: [] } } }];
    const findings = detectHardFindings(caseDef, run, score, turns);
    assert.equal(findings.some((f) => f.kind === "temporal_stale_date_regression"), false, "omission alone must never trip the guard — only the normal scorer's own factuality check may fail this row");
  });

  test("invoice-03: a searchInvoices tool result lacking INV-1004 triggers the hard Product-regression finding", () => {
    const caseDef = findCase("invoice-03");
    const run: RunResult = {
      caseId: caseDef.id,
      repetition: 1,
      provider: "anthropic",
      model: "fake",
      finalText: "I couldn't find a matching invoice.",
      providerCalls: [],
      toolCalls: [{ toolName: "searchInvoices", args: { query: "totally nonexistent" }, isRegisteredTool: true, resultOk: true, resultErrorKind: null }],
      protocolViolation: false,
      errorClass: null,
      totalLatencyMs: 1,
      totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      estimatedCostUsd: 0,
    };
    const score = scoreRun(caseDef, run);
    const turns = [{ providerCallIndex: 0, latencyMs: 1, usage: null, responseKind: "toolCall" as const, toolCall: { toolName: "searchInvoices", args: { query: "totally nonexistent" } }, toolResult: { ok: true, errorKind: null, result: { ok: true, results: [] } } }];
    const findings = detectHardFindings(caseDef, run, score, turns);
    assert.ok(findings.some((f) => f.kind === "invoice03_missing_target_retrieval"));
  });

  test("invoice-03: a searchInvoices tool result containing INV-1004 does NOT trigger the finding", () => {
    const caseDef = findCase("invoice-03");
    const run: RunResult = {
      caseId: caseDef.id,
      repetition: 1,
      provider: "anthropic",
      model: "fake",
      finalText: "INV-1004, for Brightline Robotics' Warehouse Automation Pilot project.",
      providerCalls: [],
      toolCalls: [{ toolName: "searchInvoices", args: { query: "Brightline Robotics Warehouse Automation Pilot" }, isRegisteredTool: true, resultOk: true, resultErrorKind: null }],
      protocolViolation: false,
      errorClass: null,
      totalLatencyMs: 1,
      totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      estimatedCostUsd: 0,
    };
    const score = scoreRun(caseDef, run);
    const turns = [
      {
        providerCallIndex: 0,
        latencyMs: 1,
        usage: null,
        responseKind: "toolCall" as const,
        toolCall: { toolName: "searchInvoices", args: { query: "Brightline Robotics Warehouse Automation Pilot" } },
        toolResult: { ok: true, errorKind: null, result: { ok: true, results: [{ invoiceNumber: "INV-1004" }] } },
      },
    ];
    const findings = detectHardFindings(caseDef, run, score, turns);
    assert.equal(findings.some((f) => f.kind === "invoice03_missing_target_retrieval"), false);
  });

  test("real end-to-end sweep: invoice-03 with the real fixture executor correctly returning INV-1004 for a combined client+project query produces zero hard findings", async () => {
    const selection = selectionFor(["invoice-03"], ["anthropic"], 1, "e2e-invoice03");
    const spec: SubsetProviderSpec = multiTurnSpec("anthropic", [
      [
        { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchInvoices", args: { query: "Brightline Robotics Warehouse Automation Pilot" } }, usage: USAGE } },
        { kind: "ok", response: { kind: "text", text: "That's invoice INV-1004.", usage: USAGE } },
      ],
    ]);
    const outcome = await executeSubsetSweep(selection, { anthropic: spec, openai: spec });
    assert.equal(outcome.aborted, false);
    assert.equal(outcome.hardFindings.length, 0);
    assert.equal(outcome.rows[0].factuality.missing.length, 0);
  });

  test("no decideOutcome()/quality-gate conclusion ever appears in the built artifact or report", async () => {
    const selection = selectionFor(["client-search-01"], ["anthropic"], 1, "no-decision");
    const spec: SubsetProviderSpec = multiTurnSpec("anthropic", [
      [{ kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: "" } }, usage: USAGE } }, { kind: "ok", response: { kind: "text", text: "Alderbrook Studio, Brightline Robotics.", usage: USAGE } }],
    ]);
    const outcome = await executeSubsetSweep(selection, { anthropic: spec, openai: spec });
    const artifact = buildSubsetArtifact(selection, outcome);
    const serialized = JSON.stringify(artifact);
    const md = buildSubsetReportMarkdown(artifact);
    for (const forbidden of ["SELECT_ANTHROPIC", "SELECT_OPENAI", "NO_MODEL_PASSES_QUALITY_GATE", "TIE_ADDITIONAL_EVIDENCE_REQUIRED", "MODEL_A_WINS", "MODEL_B_WINS"]) {
      assert.equal(serialized.includes(forbidden), false, `artifact JSON must never contain "${forbidden}"`);
      assert.equal(md.includes(forbidden), false, `report markdown must never contain "${forbidden}"`);
    }
    assert.match(md, /NOT AN OFFICIAL BENCHMARK RESULT/);
    // Structural proof, not a text-search for "decideOutcome(" (which
    // would false-positive on this exact doc-comment sentence naming the
    // constraint): subset.ts has no binding for decideOutcome at all
    // without an import from decision.ts — so the absence of that import
    // is itself sufficient proof the function can never be called here.
    const source = readFileSync(join(PACKAGE_DIR, "subset.ts"), "utf8");
    assert.equal(source.includes('from "./decision.js"'), false, "subset.ts must never import decision.ts");
  });

  test("classifySubsetObservations: clean (0/2), observation (1/2), systematic_concern (2/2)", () => {
    const rows = [
      { caseId: "a", provider: "anthropic" as const, repetition: 1, factuality: { missing: [], needsHumanReview: false } },
      { caseId: "a", provider: "anthropic" as const, repetition: 2, factuality: { missing: [], needsHumanReview: false } },
      { caseId: "b", provider: "anthropic" as const, repetition: 1, factuality: { missing: ["x"], needsHumanReview: false } },
      { caseId: "b", provider: "anthropic" as const, repetition: 2, factuality: { missing: [], needsHumanReview: false } },
      { caseId: "c", provider: "anthropic" as const, repetition: 1, factuality: { missing: ["x"], needsHumanReview: false } },
      { caseId: "c", provider: "anthropic" as const, repetition: 2, factuality: { missing: ["x"], needsHumanReview: false } },
    ] as unknown as import("../report.js").ArtifactRow[];
    const observations = classifySubsetObservations(rows);
    const byCaseId = new Map(observations.map((o) => [o.caseId, o]));
    assert.equal(byCaseId.get("a")!.level, "clean");
    assert.equal(byCaseId.get("b")!.level, "observation");
    assert.equal(byCaseId.get("c")!.level, "systematic_concern");
  });

  test("writeSubsetArtifacts writes only inside the given output directory, never results/ or canary-results/", async () => {
    const dir = tmpOutputDir();
    rmSync(dir, { recursive: true, force: true }); // exercise the mkdirSync(recursive) path too
    const selection = selectionFor(["client-search-01"], ["anthropic"], 1, "write-test");
    const spec: SubsetProviderSpec = multiTurnSpec("anthropic", [
      [{ kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: { query: "" } }, usage: USAGE } }, { kind: "ok", response: { kind: "text", text: "Alderbrook Studio, Brightline Robotics.", usage: USAGE } }],
    ]);
    const beforeResultsHash = existsSync(join(RESULTS_DIR, "results.json")) ? readFileSync(join(RESULTS_DIR, "results.json"), "utf8") : null;
    const beforeCanaryHash = existsSync(join(CANARY_RESULTS_DIR, "canary-result.json")) ? readFileSync(join(CANARY_RESULTS_DIR, "canary-result.json"), "utf8") : null;

    const outcome = await executeSubsetSweep(selection, { anthropic: spec, openai: spec });
    const artifact = buildSubsetArtifact(selection, outcome);
    const written = writeSubsetArtifacts(dir, artifact, outcome.forensicTraceRows, BENCHMARK_CASES);

    assert.ok(existsSync(written.jsonPath));
    assert.ok(existsSync(written.markdownPath));
    assert.ok(written.jsonPath.startsWith(dir));
    assert.ok(written.markdownPath.startsWith(dir));
    if (written.forensicTracePath) {
      assert.ok(written.forensicTracePath.startsWith(dir));
      assert.ok(written.forensicTracePath.endsWith("subset-forensic-trace.json"));
    }

    const afterResultsHash = existsSync(join(RESULTS_DIR, "results.json")) ? readFileSync(join(RESULTS_DIR, "results.json"), "utf8") : null;
    const afterCanaryHash = existsSync(join(CANARY_RESULTS_DIR, "canary-result.json")) ? readFileSync(join(CANARY_RESULTS_DIR, "canary-result.json"), "utf8") : null;
    assert.equal(afterResultsHash, beforeResultsHash, "official results/ must be byte-identical before/after a subset write");
    assert.equal(afterCanaryHash, beforeCanaryHash, "canary-results/ must be byte-identical before/after a subset write");

    rmSync(dir, { recursive: true, force: true });
  });
});
