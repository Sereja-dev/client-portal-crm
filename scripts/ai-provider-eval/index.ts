#!/usr/bin/env -S node
/**
 * Isolated Aqenra AI provider benchmark harness — CLI entry point.
 *
 * CRITICAL: the default invocation (no flags, i.e. `npm run eval` or
 * `tsx index.ts`) performs VALIDATION/DRY-RUN ONLY and makes NO network
 * call. A live run against the real Anthropic/OpenAI APIs requires the
 * explicit `--run` flag — see README.md's own "Live-run command"
 * section. This file never imports providers/anthropic.ts or
 * providers/openai.ts (both of which construct real SDK clients) except
 * via a dynamic `import()` INSIDE the `--run` branch, so no static
 * top-level import path can ever reach a real client constructor when
 * `--run` is absent — see test/no-live-by-default.test.ts for the
 * mechanical proof.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK_CASES, assertExactlyThirtySixBalancedCases } from "./cases.js";
import { runBenchmarkTurn } from "./loop.js";
import { completeWithStub } from "./providers/stub.js";
import { scoreRun } from "./scoring.js";
import { aggregate, decideOutcome } from "./decision.js";
import { estimateAnthropicCostUsd, estimateOpenAiCostUsd } from "./pricing.js";
import { hasAnthropicEvalApiKey, hasOpenAiEvalApiKey } from "./secrets.js";
import { buildArtifactRow, buildReproducibilityMetadata, writeReport, safeGitSha, RESULTS_DIR, type ArtifactRow } from "./report.js";
import { checkSnapshotFreshness, describeFreshnessFailure } from "./snapshot-freshness.js";
import { buildDraftingBlindArtifacts, writeDraftingBlindArtifacts } from "./drafting-packet.js";
import type { BenchmarkProviderId, RunResult } from "./result-types.js";
import type { CaseScore } from "./scoring.js";
import { BENCHMARK_DEFINITION_VERSION } from "./benchmark-version.js";
import { createRunTraceCollector, buildForensicTraceRow, writeForensicTrace, type ForensicTraceRow, type RowBuildResult, FORENSIC_TRACE_SCHEMA_VERSION } from "./forensic-trace.js";
import { CANARY_CASE_ID, CANARY_MAX_PROVIDER_CALLS, executeCanarySweep, writeCanaryReport } from "./canary.js";
import {
  parseSubsetSelectionArgs,
  checkSubsetOutputDirEmpty,
  buildSubsetPreview,
  executeSubsetSweep,
  buildSubsetArtifact,
  writeSubsetArtifacts,
  isWorkingTreeDirty,
  type SubsetProviderSpec,
} from "./subset.js";

const CANONICAL_SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tool-contracts.snapshot.json");

/**
 * Eval-test isolation seam (never a live-user feature — see README.md's
 * own "Secret handling"/canary sections for the real, credential-based
 * gates this is layered on top of, never a replacement for).
 *
 * `AQENRA_EVAL_TEST_NO_LIVE=1` is the PRIMARY mechanical boundary that
 * makes an ordinary eval-test subprocess incapable of reaching a real
 * provider, independent of whatever credential values (real, empty, or
 * realistic-looking sentinel strings) happen to be present in its own
 * env — see enforceTestNoLiveOrExit() below for exactly where this is
 * checked. `AQENRA_EVAL_TEST_SNAPSHOT_PATH` lets a test point the
 * freshness gate at an isolated temp-file copy instead of the real,
 * committed snapshot, so a "stale snapshot" ordering test never has to
 * mutate (and race other tests over) the one real
 * fixtures/tool-contracts.snapshot.json file. Deliberately gated on
 * AQENRA_EVAL_TEST_NO_LIVE also being "1": a snapshot-path override is
 * only ever honored inside an already-no-live-guaranteed invocation, so
 * this seam can never be used to weaken real --run/--canary freshness
 * enforcement — see resolveSnapshotPath() below.
 */
function isTestNoLiveActive(): boolean {
  return process.env.AQENRA_EVAL_TEST_NO_LIVE === "1";
}

function resolveSnapshotPath(): string {
  const override = process.env.AQENRA_EVAL_TEST_SNAPSHOT_PATH;
  if (isTestNoLiveActive() && override) {
    return override;
  }
  return CANONICAL_SNAPSHOT_PATH;
}

/**
 * The LATEST safe point before any provider-touching code — called
 * immediately before the dynamic `import("./providers/...")` in both
 * runCanary() and runLiveBenchmark(), i.e. strictly AFTER every ordering
 * preflight (snapshot freshness, results-dir emptiness, credential
 * presence) has already had its own chance to fire its own specific
 * message first. This is deliberate: an eval-test subprocess whose whole
 * purpose is to prove one of those earlier orderings must still be able
 * to observe that check's real behavior — this guard's only job is to
 * guarantee that even if every earlier check is somehow satisfied (a
 * fresh-looking snapshot, an empty/absent results dir, real-shaped
 * present credentials), a test carrying AQENRA_EVAL_TEST_NO_LIVE=1 can
 * never cross into a dynamic provider import, client construction, or
 * network call. Never depends on credential state, snapshot state, or
 * results-dir state — it fires unconditionally once reached, purely from
 * this one env var.
 */
function enforceTestNoLiveOrExit(): boolean {
  if (isTestNoLiveActive()) {
    console.error("TEST_NO_LIVE — refusing to proceed into provider code: AQENRA_EVAL_TEST_NO_LIVE=1 is set. This is an eval-test isolation boundary, never a live-user gate. No provider import, client construction, or request was made.");
    process.exitCode = 1;
    return false;
  }
  return true;
}

const DEFAULT_REPETITIONS = 3;

type Mode = "dry-run" | "validate" | "run" | "report" | "canary" | "subset" | "subset-preview";

function parseArgs(argv: string[]): { mode: Mode; repetitions: number; withForensicTrace: boolean } {
  const hasFlag = (flag: string) => argv.includes(flag);
  const repetitionsArg = argv.find((a) => a.startsWith("--repetitions="));
  const repetitions = repetitionsArg ? Number(repetitionsArg.split("=")[1]) : DEFAULT_REPETITIONS;
  // Parsed unconditionally, for every mode — main() decides what to do
  // with it (only "run" mode ever acts on it; every other mode prints an
  // inert warning and otherwise ignores it, never a hidden env/config
  // toggle — see README.md's own "Forensic trace observability" section).
  const withForensicTrace = hasFlag("--with-forensic-trace");

  // Checked before --canary/--run: --subset-preview and --subset are
  // their own distinct, explicit modes (never an overload of --run,
  // --canary, or --dry-run — see subset.ts's own header comment and
  // README.md's own "Bounded live validation subset" section). Neither
  // ever falls through to any other branch below. `repetitions` here is
  // unused by either branch — both resolve their own --repetitions=
  // strictly via subset.ts's own parseSubsetSelectionArgs(), which
  // enforces MAX_SUBSET_REPETITIONS and requires the flag be explicit.
  if (hasFlag("--subset-preview")) return { mode: "subset-preview", repetitions, withForensicTrace };
  if (hasFlag("--subset")) return { mode: "subset", repetitions, withForensicTrace };

  // Checked BEFORE --run so a caller who (mistakenly) passes both gets the
  // narrower, cheaper canary mode rather than the full sweep — canary is
  // never affected by --repetitions (its own repetition count is always
  // exactly 1, hardcoded in runCanary()), so `repetitions` here is unused
  // by that branch.
  if (hasFlag("--canary")) return { mode: "canary", repetitions, withForensicTrace };
  if (hasFlag("--run")) return { mode: "run", repetitions, withForensicTrace };
  if (hasFlag("--validate")) return { mode: "validate", repetitions: DEFAULT_REPETITIONS, withForensicTrace };
  if (hasFlag("--report")) return { mode: "report", repetitions: DEFAULT_REPETITIONS, withForensicTrace };
  // No recognized flag, including plain `--dry-run` or no args at all —
  // dry-run is the one and only default (see this file's own header
  // comment).
  return { mode: "dry-run", repetitions: DEFAULT_REPETITIONS, withForensicTrace };
}

function runStructuralValidation(): void {
  assertExactlyThirtySixBalancedCases();
  console.log(`Structural validation passed: ${BENCHMARK_CASES.length} cases across 12 balanced categories.`);
}

async function runOfflinePipeline(): Promise<void> {
  console.log("Running the full loop -> scoring -> report pipeline OFFLINE against the stub provider (no network, no SDK client constructed).");
  const rows: ArtifactRow[] = [];
  for (const caseDef of BENCHMARK_CASES) {
    const run: RunResult = {
      ...(await runBenchmarkTurn({
        provider: "anthropic",
        model: "stub",
        complete: completeWithStub,
        userMessage: caseDef.prompt,
        estimateCostUsd: () => 0,
      })),
      caseId: caseDef.id,
      repetition: 1,
    };
    const score = scoreRun(caseDef, run);
    rows.push(buildArtifactRow(run, score));
  }
  console.log(`Offline pipeline exercised all ${rows.length} cases through the real fixture tool executors and scoring logic — zero network calls made.`);
}

/**
 * CRITICAL ordering: this is the FIRST thing runLiveBenchmark() checks —
 * before the repetitions warning, before any secret-presence check,
 * before any dynamic provider import, before any client construction,
 * before any network. A stale snapshot must never even reach the point
 * of asking whether keys are present (see snapshot-freshness.ts's own
 * header comment and test/snapshot-freshness.test.ts's own no-live
 * ordering proof).
 */
function enforceSnapshotFreshnessOrExit(): boolean {
  const snapshotPath = resolveSnapshotPath();
  let raw: string;
  try {
    raw = readFileSync(snapshotPath, "utf8");
  } catch {
    console.error(`Could not read the tool-contract snapshot at ${snapshotPath}. Refresh it: npm run extract (from scripts/ai-provider-eval/)`);
    process.exitCode = 1;
    return false;
  }

  const snapshot: unknown = JSON.parse(raw);
  const result = checkSnapshotFreshness(snapshot as { sourceFingerprint?: unknown; fingerprintAlgorithm?: unknown });
  if (!result.fresh) {
    console.error("SNAPSHOT_STALE — refusing to run the live benchmark.");
    console.error(describeFreshnessFailure(result));
    process.exitCode = 1;
    return false;
  }
  return true;
}

/**
 * Fail-closed pre-flight, run immediately after the snapshot-freshness
 * gate and before anything else (repetitions warning, secret-presence
 * check, provider import, network): refuse to start a live run if the
 * official RESULTS_DIR already contains artifacts from a prior run.
 * writeReport() writes results.json/results.csv/report.md with a plain
 * writeFileSync — an unconditional overwrite with no diff, backup, or
 * warning — so without this check a second official run would silently
 * mix with or destroy the first, with no trace of which is which. This
 * check never deletes or modifies anything itself; it only refuses to
 * proceed. See README.md's own "Artifact lifecycle" section for the
 * required archive-before-rerun operator procedure.
 */
function enforceResultsDirEmptyOrExit(): boolean {
  const staleFiles = ["results.json", "results.csv", "report.md", "forensic-trace.json"].filter((name) => existsSync(join(RESULTS_DIR, name)));
  if (staleFiles.length > 0) {
    console.error(`STALE_RESULTS_DIR — refusing to run: ${RESULTS_DIR} already contains ${staleFiles.join(", ")} from a prior run.`);
    console.error("Archive the existing results/ directory before starting a new official run — see README.md's own \"Artifact lifecycle\" section. Nothing was deleted or modified.");
    process.exitCode = 1;
    return false;
  }
  return true;
}

/**
 * Bounded live protocol canary CLI entry — see this file's own header
 * comment on --canary and README.md's own "Live protocol canary"
 * section. All of the actual sweep/classification/artifact-writing logic
 * lives in canary.ts, imported above — kept out of this file so that
 * module stays free of index.ts's own top-level main() side effect and
 * remains directly, safely importable from test/canary.test.ts (see
 * canary.ts's own header comment for exactly why). This function's own
 * job is only: enforce the fail-closed ordering, perform the real
 * dynamic provider imports, and call executeCanarySweep()/writeCanaryReport().
 */
async function runCanary(): Promise<void> {
  // Same fail-closed ordering discipline as runLiveBenchmark(): freshness,
  // then the fixed case, then credentials, then (and only then) a dynamic
  // provider import and any network call. Never weakened or bypassed for
  // canary.
  if (!enforceSnapshotFreshnessOrExit()) {
    return;
  }

  const caseDef = BENCHMARK_CASES.find((c) => c.id === CANARY_CASE_ID);
  if (!caseDef) {
    console.error(`CANARY_CASE_NOT_FOUND — "${CANARY_CASE_ID}" is not present in BENCHMARK_CASES. No provider call was made.`);
    process.exitCode = 1;
    return;
  }

  if (!hasAnthropicEvalApiKey() || !hasOpenAiEvalApiKey()) {
    console.error(
      "CREDENTIAL_MISSING — AQENRA_EVAL_ANTHROPIC_API_KEY and/or AQENRA_EVAL_OPENAI_API_KEY is not set. See README.md's own \"Secret handling\" section. No request was made.",
    );
    process.exitCode = 1;
    return;
  }

  if (!enforceTestNoLiveOrExit()) {
    return;
  }

  // Dynamic import, deliberately inside this function and reached only
  // after the freshness+case+credential+test-no-live checks above —
  // mirrors runLiveBenchmark()'s own identical discipline (see this
  // file's own header comment on why no static import path may ever
  // reach a real client constructor).
  const { completeWithAnthropic } = await import("./providers/anthropic.js");
  const { completeWithOpenAi } = await import("./providers/openai.js");
  const { ANTHROPIC_MODEL_ID, OPENAI_MODEL_ID } = await import("./pricing.js");

  console.log(`Running bounded live canary — case "${CANARY_CASE_ID}", max ${CANARY_MAX_PROVIDER_CALLS} provider calls per provider (absolute ceiling: ${CANARY_MAX_PROVIDER_CALLS * 2} live requests).`);

  // OpenAI first, Anthropic second — Anthropic still runs even if OpenAI
  // fails deterministically. Each provider is fully independent evidence
  // within this one bounded authorization; skipping the second provider
  // on the first one's failure would mean a second live invocation is
  // needed just to learn about it, at no safety benefit (see the design
  // audit's own §K reasoning) — see executeCanarySweep()'s own doc
  // comment, which enforces this by always iterating every spec.
  const sweep = await executeCanarySweep(caseDef, [
    { id: "openai", model: OPENAI_MODEL_ID, complete: completeWithOpenAi, estimateCostUsd: estimateOpenAiCostUsd },
    { id: "anthropic", model: ANTHROPIC_MODEL_ID, complete: completeWithAnthropic, estimateCostUsd: estimateAnthropicCostUsd },
  ]);

  const written = writeCanaryReport(sweep.providers);
  console.log(`Canary artifact written to ${written.path}`);
  console.log(`Overall: ${written.overall}`);
  if (written.overall !== "PASS") {
    process.exitCode = 1;
  }
}

/**
 * `--subset-preview` — the required operator confirmation step before a
 * future live `--subset` run (see subset.ts's own buildSubsetPreview()
 * doc comment). Parses and fully validates the exact same selection
 * `--subset` would use, resolves the output path, and prints every
 * value a `--subset` run would act on — WITHOUT requiring credentials,
 * WITHOUT any dynamic provider import, and WITHOUT writing any artifact.
 * This function never reaches enforceTestNoLiveOrExit()/a dynamic
 * import at all, by construction — there is no code path from here to
 * either.
 */
async function runSubsetPreview(argv: string[]): Promise<void> {
  const parsed = parseSubsetSelectionArgs(argv);
  if (!parsed.ok) {
    console.error(`SUBSET_SELECTION_INVALID — ${parsed.reason}`);
    process.exitCode = 1;
    return;
  }
  const preview = buildSubsetPreview(parsed.selection);
  console.log(JSON.stringify(preview, null, 2));
  console.log(`\nPreview complete — no network call was made, no credentials were required, and no artifact was written. Pass --subset (with the required AQENRA_EVAL_*_API_KEY env vars for every selected provider) to execute this exact plan live.`);
}

/**
 * `--subset` — the bounded, non-official live validation subset runner
 * (see subset.ts's own header comment). Mirrors runCanary()'s own
 * fail-closed gate ORDERING exactly: selection validation (pure, no I/O
 * beyond the run-id's own path arithmetic) -> snapshot freshness ->
 * output-directory preflight -> working-tree dirtiness -> credentials
 * (ALL selected providers validated together, before touching any) ->
 * AQENRA_EVAL_TEST_NO_LIVE -> only THEN a dynamic provider import, and
 * only for the providers actually selected. All orchestration/gating
 * logic lives here, in index.ts, exactly like runCanary()/
 * runLiveBenchmark() — subset.ts itself owns only the injectable,
 * test-importable core (selection parsing, the sweep, artifact writing).
 */
async function runSubset(argv: string[]): Promise<void> {
  const parsed = parseSubsetSelectionArgs(argv);
  if (!parsed.ok) {
    console.error(`SUBSET_SELECTION_INVALID — ${parsed.reason}`);
    process.exitCode = 1;
    return;
  }
  const selection = parsed.selection;

  if (!enforceSnapshotFreshnessOrExit()) {
    return;
  }

  const dirCheck = checkSubsetOutputDirEmpty(selection.outputDir);
  if (!dirCheck.ok) {
    console.error(`SUBSET_OUTPUT_DIR_NOT_EMPTY — ${dirCheck.reason}`);
    process.exitCode = 1;
    return;
  }

  // Fail-closed on a DEFINITE dirty tree; a git failure ("unknown") is
  // reported loudly but never blocks — mirrors safeGitSha()'s own
  // fail-open convention for git-command failures elsewhere in this
  // package (report.ts), since refusing to run over an infrastructure
  // hiccup (git itself unavailable) would be a worse failure mode than a
  // clearly-labeled best-effort warning. Skipped entirely when
  // AQENRA_EVAL_TEST_NO_LIVE=1 is already set — mirrors this file's own
  // resolveSnapshotPath() precedent (a test-isolation seam that only
  // ever activates once TEST_NO_LIVE has ALREADY guaranteed this
  // invocation can never reach a real provider no matter what): this
  // package's own repo working tree is routinely non-clean during active
  // development/CI, and every credential/TEST_NO_LIVE regression test
  // below needs to deterministically reach ITS OWN target gate
  // regardless of that — weakening a real-run-only convenience check
  // under an already-absolute safety boundary is safe; weakening
  // enforceTestNoLiveOrExit() itself (below) would not be, and is never
  // done anywhere in this codebase.
  if (!isTestNoLiveActive()) {
    const dirty = isWorkingTreeDirty();
    if (dirty === true) {
      console.error("SUBSET_DIRTY_WORKING_TREE — refusing to run a live bounded subset with uncommitted local changes present (git status --porcelain is non-empty). Commit, stash, or discard local changes first. No provider was touched.");
      process.exitCode = 1;
      return;
    }
    if (dirty === "unknown") {
      console.warn("WARNING: could not determine working-tree cleanliness (git status --porcelain failed) — proceeding, but the recorded gitSha in this run's own artifact may not fully describe what was executed.");
    }
  }

  if (selection.providers.includes("anthropic") && !hasAnthropicEvalApiKey()) {
    console.error("Missing AQENRA_EVAL_ANTHROPIC_API_KEY for a selected provider (anthropic). See README.md's own \"Secret handling\" section. No request was made.");
    process.exitCode = 1;
    return;
  }
  if (selection.providers.includes("openai") && !hasOpenAiEvalApiKey()) {
    console.error("Missing AQENRA_EVAL_OPENAI_API_KEY for a selected provider (openai). See README.md's own \"Secret handling\" section. No request was made.");
    process.exitCode = 1;
    return;
  }

  if (!enforceTestNoLiveOrExit()) {
    return;
  }

  const providerSpecsById: Partial<Record<BenchmarkProviderId, SubsetProviderSpec>> = {};
  if (selection.providers.includes("anthropic")) {
    const { completeWithAnthropic } = await import("./providers/anthropic.js");
    const { ANTHROPIC_MODEL_ID } = await import("./pricing.js");
    providerSpecsById.anthropic = { id: "anthropic", model: ANTHROPIC_MODEL_ID, complete: completeWithAnthropic, estimateCostUsd: estimateAnthropicCostUsd };
  }
  if (selection.providers.includes("openai")) {
    const { completeWithOpenAi } = await import("./providers/openai.js");
    const { OPENAI_MODEL_ID } = await import("./pricing.js");
    providerSpecsById.openai = { id: "openai", model: OPENAI_MODEL_ID, complete: completeWithOpenAi, estimateCostUsd: estimateOpenAiCostUsd };
  }

  console.log(`Running bounded live subset — run-id "${selection.runId}", ${selection.cases.length} cases × ${selection.providers.length} providers × ${selection.repetitions} repetitions = ${selection.totalTurns} planned turns (absolute provider-call ceiling: ${selection.absoluteProviderCallCeiling}).`);
  console.log(`BOUNDED LIVE VALIDATION — NOT AN OFFICIAL BENCHMARK RESULT. Output: ${selection.outputDir}`);

  const outcome = await executeSubsetSweep(selection, providerSpecsById as Record<BenchmarkProviderId, SubsetProviderSpec>);
  const artifact = buildSubsetArtifact(selection, outcome);
  const written = writeSubsetArtifacts(selection.outputDir, artifact, outcome.forensicTraceRows, BENCHMARK_CASES);

  if (outcome.aborted) {
    console.error(`SUBSET_ABORTED — ${outcome.abortReason}`);
    console.error(`Completed ${outcome.completedTurns} of ${outcome.plannedTurns} planned turns before stopping.`);
    process.exitCode = 1;
  } else {
    console.log(`Subset complete — ${outcome.completedTurns}/${outcome.plannedTurns} turns, ${outcome.providerCallsUsed} provider calls used (ceiling ${selection.absoluteProviderCallCeiling}).`);
  }
  console.log(`Results written to ${written.jsonPath}`);
  console.log(`Report written to ${written.markdownPath}`);
  if (written.forensicTracePath) {
    console.log(`Forensic trace written to ${written.forensicTracePath}`);
  } else if (outcome.forensicTraceCaptureFailures.length > 0) {
    console.error(`Forensic trace capture failed for ${outcome.forensicTraceCaptureFailures.length} row(s) — see subset-report.md for details. This never invalidates subset-results.json.`);
  }
}

async function runLiveBenchmark(repetitions: number, withForensicTrace: boolean): Promise<void> {
  if (!enforceSnapshotFreshnessOrExit()) {
    return;
  }
  if (!enforceResultsDirEmptyOrExit()) {
    return;
  }

  if (repetitions !== DEFAULT_REPETITIONS) {
    console.warn(`NON_OFFICIAL_RUN — repetitions=${repetitions} overrides the default of ${DEFAULT_REPETITIONS}. This report will be marked non-official.`);
  }
  if (!hasAnthropicEvalApiKey() || !hasOpenAiEvalApiKey()) {
    console.error("Missing AQENRA_EVAL_ANTHROPIC_API_KEY and/or AQENRA_EVAL_OPENAI_API_KEY. See README.md's own \"Secret handling\" section. No request was made.");
    process.exitCode = 1;
    return;
  }

  if (!enforceTestNoLiveOrExit()) {
    return;
  }

  // Dynamic import, deliberately INSIDE this function (only reached from
  // the --run branch, and only after the freshness+results-dir+secret+
  // test-no-live checks above) — see this file's own header comment for
  // why.
  const { completeWithAnthropic } = await import("./providers/anthropic.js");
  const { completeWithOpenAi } = await import("./providers/openai.js");
  const { ANTHROPIC_MODEL_ID, OPENAI_MODEL_ID } = await import("./pricing.js");

  const providers: { id: BenchmarkProviderId; model: string; complete: typeof completeWithAnthropic; estimateCostUsd: (p: number, c: number) => number }[] = [
    { id: "anthropic", model: ANTHROPIC_MODEL_ID, complete: completeWithAnthropic, estimateCostUsd: estimateAnthropicCostUsd },
    { id: "openai", model: OPENAI_MODEL_ID, complete: completeWithOpenAi, estimateCostUsd: estimateOpenAiCostUsd },
  ];

  const rows: ArtifactRow[] = [];
  // Raw RunResults are kept separately from the sanitized ArtifactRow
  // list — ArtifactRow deliberately never carries the model's own raw
  // finalText (see report.ts's own ArtifactRow shape), but the blind
  // drafting packet (drafting-packet.ts) needs exactly that text, so it
  // consumes this raw array instead of rows.
  const allRuns: RunResult[] = [];
  const scoresByProvider: Record<BenchmarkProviderId, CaseScore[]> = { anthropic: [], openai: [] };
  const latenciesByProvider: Record<BenchmarkProviderId, number[]> = { anthropic: [], openai: [] };
  const costsByProvider: Record<BenchmarkProviderId, number[]> = { anthropic: [], openai: [] };
  // Only populated when --with-forensic-trace was passed. Purely
  // observational (see forensic-trace.ts's own header comment and
  // result-types.ts's TraceSink doc comment) — createRunTraceCollector()
  // is never consulted for any decision in the sweep loop below; it only
  // accumulates already-normalized events that runBenchmarkTurn() fires
  // regardless, so a run with tracing on and one with it off produce the
  // identical RunResult/CaseScore either way (see
  // test/forensic-trace-observational-equivalence.test.ts).
  const traceRowResults: RowBuildResult[] = [];

  for (const caseDef of BENCHMARK_CASES) {
    for (const provider of providers) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const collector = withForensicTrace ? createRunTraceCollector() : null;
        const run: RunResult = {
          ...(await runBenchmarkTurn({
            provider: provider.id,
            model: provider.model,
            complete: provider.complete,
            userMessage: caseDef.prompt,
            estimateCostUsd: provider.estimateCostUsd,
            traceSink: collector?.sink,
          })),
          caseId: caseDef.id,
          repetition,
        };
        const score = scoreRun(caseDef, run);
        rows.push(buildArtifactRow(run, score));
        allRuns.push(run);
        scoresByProvider[provider.id].push(score);
        latenciesByProvider[provider.id].push(run.totalLatencyMs);
        costsByProvider[provider.id].push(run.estimatedCostUsd);
        if (collector) {
          // A recorded sink-event-collection failure (loop.ts's own
          // safeEmitTraceEvent() instrumentation boundary caught a
          // throwing traceSink callback — see forensic-trace.ts's own
          // createRunTraceCollector() doc comment) is treated as just one
          // more RowBuildResult failure, feeding the exact same
          // requested_but_failed status semantics as a bounds/validation
          // failure below — never partially collected and later called
          // "captured".
          const captureFailure = collector.getCaptureFailure();
          traceRowResults.push(
            captureFailure
              ? { ok: false, reason: `${caseDef.id}#rep${repetition} (${provider.id}): forensic trace capture failed during event collection — ${captureFailure.message}` }
              : buildForensicTraceRow({ caseDef, run, score, turns: collector.getTurns() }),
          );
        }
      }
    }
  }

  const caseIndex = new Map(BENCHMARK_CASES.map((c) => [c.id, { category: c.category, expectedFactGroupsCount: c.expectedFactGroups.length, mutationRequired: c.mutationMustBeRefused }]));

  const anthropicAgg = aggregate("anthropic", scoresByProvider.anthropic, latenciesByProvider.anthropic, costsByProvider.anthropic, caseIndex);
  const openaiAgg = aggregate("openai", scoresByProvider.openai, latenciesByProvider.openai, costsByProvider.openai, caseIndex);
  const decision = decideOutcome(anthropicAgg, openaiAgg);

  // Forensic-trace status must be known BEFORE buildReproducibilityMetadata()
  // is called below, since it's recorded as a field on that same metadata
  // object (see report.ts's own ReproducibilityMetadata) — so trace
  // build/validate/write happens here, strictly before regular
  // report/results generation, never after (see forensic-trace.ts's own
  // header comment on why no circular dependency exists: this file never
  // embeds results.json's own hash, only the reverse ordering constraint).
  // A trace failure NEVER blocks or invalidates the official aggregate
  // artifacts below — only forensicTraceStatus reflects it, loudly.
  let forensicTraceStatus: "captured" | "requested_but_failed" | "not_requested" = "not_requested";
  if (withForensicTrace) {
    const failedRow = traceRowResults.find((r): r is { ok: false; reason: string } => !r.ok);
    if (failedRow) {
      console.error(`FORENSIC_TRACE_FAILED — ${failedRow.reason}`);
      forensicTraceStatus = "requested_but_failed";
    } else {
      const traceRows: ForensicTraceRow[] = traceRowResults.map((r) => (r as { ok: true; row: ForensicTraceRow }).row);
      const traceWrite = writeForensicTrace(
        RESULTS_DIR,
        {
          forensicTraceSchemaVersion: FORENSIC_TRACE_SCHEMA_VERSION,
          benchmarkDefinitionVersion: BENCHMARK_DEFINITION_VERSION,
          gitSha: safeGitSha(),
          generatedAt: new Date().toISOString(),
          anthropicModelId: ANTHROPIC_MODEL_ID,
          openaiModelId: OPENAI_MODEL_ID,
          repetitionCount: repetitions,
          rowCount: traceRows.length,
          complete: traceRows.length === BENCHMARK_CASES.length * providers.length * repetitions,
          rows: traceRows,
        },
        BENCHMARK_CASES,
      );
      if (traceWrite.ok) {
        forensicTraceStatus = "captured";
        console.log(`Forensic trace written to ${traceWrite.path} (sha256: ${traceWrite.sha256}, ${traceWrite.bytes} bytes).`);
      } else {
        console.error(`FORENSIC_TRACE_FAILED — ${traceWrite.reason}`);
        forensicTraceStatus = "requested_but_failed";
      }
    }
  }

  const metadata = buildReproducibilityMetadata({
    repetitionCount: repetitions,
    officialRun: repetitions === DEFAULT_REPETITIONS,
    forensicTraceEnabled: withForensicTrace,
    forensicTraceStatus,
  });
  const written = writeReport({
    rows,
    metadata,
    anthropic: anthropicAgg,
    openai: openaiAgg,
    outcome: decision.outcome,
    anthropicGateFailures: decision.anthropicGate.failures,
    openaiGateFailures: decision.openaiGate.failures,
  });

  // Generated after EVERY completed official run (not only when the
  // automated comparison actually lands on TIE_ADDITIONAL_EVIDENCE_REQUIRED)
  // — see drafting-packet.ts's own header comment for why: this
  // guarantees the artifact README.md/report.ts already promise always
  // exists, with no special late path that only runs sometimes. It may
  // simply go unused if the automated comparison already decided the
  // outcome.
  const draftingArtifacts = buildDraftingBlindArtifacts(allRuns, BENCHMARK_CASES);
  const draftingWritten = writeDraftingBlindArtifacts(RESULTS_DIR, draftingArtifacts);

  console.log(`Outcome: ${decision.outcome}`);
  console.log(`Report written to ${written.markdownPath}`);
  console.log(`Blind drafting packet written to ${draftingWritten.packetPath} (mapping: ${draftingWritten.mappingPath})`);
  if (withForensicTrace) {
    console.log(`Forensic trace status: ${forensicTraceStatus}`);
  }
}

async function main(): Promise<void> {
  const { mode, repetitions, withForensicTrace } = parseArgs(process.argv.slice(2));

  // --with-forensic-trace only ever does anything inside the "run"
  // branch below. Every other mode is inert with respect to it — never
  // a hidden network path, never a file written — but silence would be
  // confusing for an operator who passed it by habit, so this prints a
  // concise warning and then proceeds with that mode's normal (already
  // no-live) behavior, unchanged.
  if (withForensicTrace && mode !== "run") {
    console.warn("Forensic trace capture only applies to --run; ignored in this mode.");
  }

  if (mode === "dry-run") {
    runStructuralValidation();
    await runOfflinePipeline();
    console.log("\nDry run complete — no network call was made. Pass --run explicitly (with both AQENRA_EVAL_*_API_KEY env vars set) to execute a live benchmark.");
    return;
  }

  if (mode === "validate") {
    runStructuralValidation();
    console.log("Validation-only mode complete — no network call was made, no full pipeline run performed.");
    return;
  }

  if (mode === "report") {
    console.log("Pass --run to generate a fresh report, or inspect results/report.md directly if one already exists (gitignored, local-only).");
    return;
  }

  if (mode === "canary") {
    // Deliberately a SEPARATE branch from "run" below — never falls
    // through to runLiveBenchmark(), never shares its repetitions/
    // withForensicTrace handling. See runCanary()'s own header comment.
    runStructuralValidation();
    await runCanary();
    return;
  }

  if (mode === "subset-preview") {
    // Deliberately never calls runStructuralValidation() — preview must
    // never import/execute anything beyond selection parsing and a
    // read-only directory/git check (see runSubsetPreview()'s own doc
    // comment: zero credentials, zero provider imports, zero artifacts).
    await runSubsetPreview(process.argv.slice(2));
    return;
  }

  if (mode === "subset") {
    runStructuralValidation();
    await runSubset(process.argv.slice(2));
    return;
  }

  // mode === "run"
  runStructuralValidation();
  await runLiveBenchmark(repetitions, withForensicTrace);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
