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
import { buildArtifactRow, buildReproducibilityMetadata, writeReport, RESULTS_DIR, type ArtifactRow } from "./report.js";
import { checkSnapshotFreshness, describeFreshnessFailure } from "./snapshot-freshness.js";
import { buildDraftingBlindArtifacts, writeDraftingBlindArtifacts } from "./drafting-packet.js";
import type { BenchmarkProviderId, RunResult } from "./result-types.js";
import type { CaseScore } from "./scoring.js";

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tool-contracts.snapshot.json");

const DEFAULT_REPETITIONS = 3;

type Mode = "dry-run" | "validate" | "run" | "report";

function parseArgs(argv: string[]): { mode: Mode; repetitions: number } {
  const hasFlag = (flag: string) => argv.includes(flag);
  const repetitionsArg = argv.find((a) => a.startsWith("--repetitions="));
  const repetitions = repetitionsArg ? Number(repetitionsArg.split("=")[1]) : DEFAULT_REPETITIONS;

  if (hasFlag("--run")) return { mode: "run", repetitions };
  if (hasFlag("--validate")) return { mode: "validate", repetitions: DEFAULT_REPETITIONS };
  if (hasFlag("--report")) return { mode: "report", repetitions: DEFAULT_REPETITIONS };
  // No recognized flag, including plain `--dry-run` or no args at all —
  // dry-run is the one and only default (see this file's own header
  // comment).
  return { mode: "dry-run", repetitions: DEFAULT_REPETITIONS };
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
  let raw: string;
  try {
    raw = readFileSync(SNAPSHOT_PATH, "utf8");
  } catch {
    console.error(`Could not read the tool-contract snapshot at ${SNAPSHOT_PATH}. Refresh it from the repository root: npx tsx scripts/ai-provider-eval/extract-fixtures.ts`);
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
  const staleFiles = ["results.json", "results.csv", "report.md"].filter((name) => existsSync(join(RESULTS_DIR, name)));
  if (staleFiles.length > 0) {
    console.error(`STALE_RESULTS_DIR — refusing to run: ${RESULTS_DIR} already contains ${staleFiles.join(", ")} from a prior run.`);
    console.error("Archive the existing results/ directory before starting a new official run — see README.md's own \"Artifact lifecycle\" section. Nothing was deleted or modified.");
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function runLiveBenchmark(repetitions: number): Promise<void> {
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

  // Dynamic import, deliberately INSIDE this function (only reached from
  // the --run branch, and only after the freshness+secret checks above)
  // — see this file's own header comment for why.
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

  for (const caseDef of BENCHMARK_CASES) {
    for (const provider of providers) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const run: RunResult = {
          ...(await runBenchmarkTurn({
            provider: provider.id,
            model: provider.model,
            complete: provider.complete,
            userMessage: caseDef.prompt,
            estimateCostUsd: provider.estimateCostUsd,
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
      }
    }
  }

  const caseIndex = new Map(BENCHMARK_CASES.map((c) => [c.id, { category: c.category, expectedFactGroupsCount: c.expectedFactGroups.length, mutationRequired: c.mutationMustBeRefused }]));

  const anthropicAgg = aggregate("anthropic", scoresByProvider.anthropic, latenciesByProvider.anthropic, costsByProvider.anthropic, caseIndex);
  const openaiAgg = aggregate("openai", scoresByProvider.openai, latenciesByProvider.openai, costsByProvider.openai, caseIndex);
  const decision = decideOutcome(anthropicAgg, openaiAgg);

  const metadata = buildReproducibilityMetadata({ repetitionCount: repetitions, officialRun: repetitions === DEFAULT_REPETITIONS });
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
}

async function main(): Promise<void> {
  const { mode, repetitions } = parseArgs(process.argv.slice(2));

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

  // mode === "run"
  runStructuralValidation();
  await runLiveBenchmark(repetitions);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
