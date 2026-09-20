/**
 * Isolated Aqenra AI provider benchmark harness — bounded, non-official
 * live validation subset runner (`index.ts`'s own `--subset` /
 * `--subset-preview` modes; see README.md's own "Bounded live validation
 * subset" section).
 *
 * NOT an official benchmark, NOT provider selection, NOT a quality-gate
 * result, and NOT a replacement for a full official `--run` sweep. Its
 * only job is to let an operator explicitly re-exercise a small,
 * explicitly-named set of cases against live providers — e.g. to check
 * that a recently-shipped Product/scorer fix behaves correctly on fresh
 * output before spending on a full 216-turn official sweep.
 *
 * Deliberately its OWN module, separate from index.ts, for the exact
 * same reason canary.ts is (see that file's own header comment):
 * index.ts has a top-level, unconditional `main().catch(...)` call, so
 * importing index.ts from a test would execute that call as an import
 * side effect. This module has no top-level side effect of its own —
 * test/subset.test.ts imports directly from here, never from index.ts.
 * index.ts's own new runSubset()/runSubsetPreview() own only the
 * fail-closed gate ORDERING (snapshot freshness, output-dir preflight,
 * credentials, AQENRA_EVAL_TEST_NO_LIVE, the dynamic provider imports)
 * — mirroring runCanary()'s own identical split exactly. This module
 * never imports a real vendor SDK itself; every live call site supplies
 * its own `complete` function.
 *
 * Deliberately reuses, and never duplicates: runBenchmarkTurn (loop.ts),
 * scoreRun (scoring.ts), buildArtifactRow (report.ts), the forensic
 * trace collector/row-builder/writer (forensic-trace.ts), safeGitSha
 * (report.ts), BENCHMARK_CASES (cases.ts), PRICING (pricing.ts),
 * ANCHOR_NOW/BENCHMARK_TIMEZONE (fixtures/organization.ts, loop.ts), and
 * MAX_PROVIDER_CALLS_PER_TURN (src/lib/ai/orchestration-limits.ts).
 * Never calls decision.ts's aggregate()/decideOutcome() — see
 * buildSubsetReportMarkdown() below.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { BENCHMARK_CASES, type BenchmarkCase } from "./cases.js";
import { runBenchmarkTurn, BENCHMARK_TIMEZONE } from "./loop.js";
import { scoreRun, type CaseScore } from "./scoring.js";
import { redactPotentialSecrets } from "./secrets.js";
import { buildArtifactRow, safeGitSha, type ArtifactRow } from "./report.js";
import { BENCHMARK_DEFINITION_VERSION } from "./benchmark-version.js";
import type { BenchmarkProviderId, RunResult } from "./result-types.js";
import { PRICING, PRICING_SNAPSHOT_DATE, getPricingFreshnessWarning } from "./pricing.js";
import { OPENAI_REASONING_EFFORT } from "./openai-compat.js";
import { ANCHOR_NOW } from "./fixtures/organization.js";
import { MAX_PROVIDER_CALLS_PER_TURN } from "../../src/lib/ai/orchestration-limits.js";
import { createRunTraceCollector, buildForensicTraceRow, writeForensicTrace, type ForensicTraceRow, type RowBuildResult, FORENSIC_TRACE_SCHEMA_VERSION } from "./forensic-trace.js";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

/** Fixed, package-local root — the ONLY place a subset run may ever write. Never operator-suppliable as an arbitrary path (see §9 of the locked spec this implements): the operator supplies only a run-id, joined under this root and containment-checked — see resolveSubsetOutputDir() below. */
export const SUBSET_RESULTS_ROOT = join(PACKAGE_DIR, "subset-results");

/** Official convention already uses 3 (DEFAULT_REPETITIONS, index.ts) — bounded validation must never silently exceed it. */
export const MAX_SUBSET_REPETITIONS = 3;

/** Permits the currently-approved 8-case × 2-provider × 2-repetition = 32-turn matrix with headroom, while rejecting an accidental near-full-benchmark-sized selection before any provider import/call. */
export const MAX_SUBSET_TURNS = 40;

const ALLOWED_SUBSET_PROVIDER_IDS: readonly BenchmarkProviderId[] = ["anthropic", "openai"];

/** `^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$` — no `/`, `\`, leading `.`/`-`, whitespace, or empty string can ever match. Path traversal (`..`) is additionally, independently foreclosed by resolveSubsetOutputDir()'s own containment check below — never relied on from the regex alone. */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

// --- selection parsing -------------------------------------------------

export type SubsetSelectionError = { ok: false; reason: string };

export type SubsetSelection = {
  caseIds: string[]; // operator-declared order, exactly as supplied
  cases: BenchmarkCase[]; // resolved BenchmarkCase objects, same order as caseIds
  providers: BenchmarkProviderId[]; // operator-declared order, exactly as supplied
  repetitions: number;
  runId: string;
  outputDir: string; // always === resolve(SUBSET_RESULTS_ROOT, runId), proven below
  totalTurns: number;
  absoluteProviderCallCeiling: number;
};

export type SubsetSelectionResult = { ok: true; selection: SubsetSelection } | SubsetSelectionError;

function parseListFlag(argv: string[], flag: string): string[] | null {
  const arg = argv.find((a) => a.startsWith(`${flag}=`));
  if (!arg) return null;
  const raw = arg.slice(flag.length + 1);
  return raw.split(",").map((s) => s.trim());
}

/**
 * Validates a run-id string is safe AND resolves to a directory
 * genuinely, literally beneath SUBSET_RESULTS_ROOT — a regex alone is
 * never treated as sufficient proof (see this file's own header
 * comment): `resolve()` normalizes any `..`/`.`/redundant-separator
 * component, and the result is then string-prefix-checked against
 * `SUBSET_RESULTS_ROOT + sep` so a value that regex-matches but somehow
 * still resolved outside the root is caught independently.
 */
export function resolveSubsetOutputDir(runId: string): { ok: true; dir: string } | { ok: false; reason: string } {
  if (!RUN_ID_PATTERN.test(runId)) {
    return { ok: false, reason: `--run-id "${runId}" is not a safe run id — must match ${RUN_ID_PATTERN.source} (no "/", "\\", "..", leading ".", whitespace, or empty value).` };
  }
  const resolved = resolve(SUBSET_RESULTS_ROOT, runId);
  const requiredPrefix = SUBSET_RESULTS_ROOT + sep;
  if (resolved !== SUBSET_RESULTS_ROOT && !resolved.startsWith(requiredPrefix)) {
    return { ok: false, reason: `--run-id "${runId}" resolved outside SUBSET_RESULTS_ROOT (${SUBSET_RESULTS_ROOT}) — refusing.` };
  }
  if (resolved === SUBSET_RESULTS_ROOT) {
    // A run-id that normalizes to the root itself (shouldn't be reachable
    // through RUN_ID_PATTERN, but checked independently as defense in
    // depth) is never a valid per-run subdirectory.
    return { ok: false, reason: `--run-id "${runId}" resolves to SUBSET_RESULTS_ROOT itself, not a subdirectory — refusing.` };
  }
  return { ok: true, dir: resolved };
}

/**
 * Parses and fully validates a `--subset`/`--subset-preview` selection
 * from argv. Pure — no filesystem write, no provider import, no network
 * call. The ONLY filesystem read this function performs is resolving
 * case IDs against the already-in-memory BENCHMARK_CASES array (no I/O)
 * and the run-id's own path arithmetic (also no I/O — resolveSubsetOutputDir
 * never stats the filesystem). Output-directory EXISTENCE/emptiness is a
 * separate, later preflight step (checkSubsetOutputDirEmpty below) —
 * deliberately kept out of this function so preview mode can resolve a
 * full selection even when the directory doesn't exist yet.
 */
export function parseSubsetSelectionArgs(argv: string[]): SubsetSelectionResult {
  const caseIdsRaw = parseListFlag(argv, "--cases");
  if (caseIdsRaw === null) return { ok: false, reason: "--cases is required for this mode (comma-separated, explicit case IDs — never a silent fallback to all 36 cases)." };
  if (caseIdsRaw.length === 0 || caseIdsRaw.every((s) => s.length === 0)) return { ok: false, reason: "--cases must not be empty." };
  const caseIds = caseIdsRaw.filter((s) => s.length > 0);
  if (caseIds.length !== caseIdsRaw.length) return { ok: false, reason: "--cases contains an empty entry (e.g. a stray comma) — refusing rather than silently dropping it." };
  const caseIdSeen = new Set<string>();
  for (const id of caseIds) {
    if (caseIdSeen.has(id)) return { ok: false, reason: `--cases contains a duplicate case ID: "${id}".` };
    caseIdSeen.add(id);
  }
  const caseById = new Map(BENCHMARK_CASES.map((c) => [c.id, c]));
  const cases: BenchmarkCase[] = [];
  for (const id of caseIds) {
    const found = caseById.get(id);
    if (!found) return { ok: false, reason: `--cases contains an unknown case ID: "${id}" (no fuzzy matching — must exactly match a BENCHMARK_CASES id).` };
    cases.push(found);
  }

  const providersRaw = parseListFlag(argv, "--providers");
  if (providersRaw === null) return { ok: false, reason: "--providers is required for this mode (comma-separated from: anthropic, openai — never an implicit \"both\" fallback)." };
  if (providersRaw.length === 0 || providersRaw.every((s) => s.length === 0)) return { ok: false, reason: "--providers must not be empty." };
  const providerIds = providersRaw.filter((s) => s.length > 0);
  if (providerIds.length !== providersRaw.length) return { ok: false, reason: "--providers contains an empty entry (e.g. a stray comma) — refusing rather than silently dropping it." };
  const providerSeen = new Set<string>();
  const providers: BenchmarkProviderId[] = [];
  for (const id of providerIds) {
    if (providerSeen.has(id)) return { ok: false, reason: `--providers contains a duplicate provider: "${id}".` };
    providerSeen.add(id);
    if (!(ALLOWED_SUBSET_PROVIDER_IDS as readonly string[]).includes(id)) {
      return { ok: false, reason: `--providers contains an unknown provider "${id}" — must be exactly one of: ${ALLOWED_SUBSET_PROVIDER_IDS.join(", ")}.` };
    }
    providers.push(id as BenchmarkProviderId);
  }

  const repetitionsArg = argv.find((a) => a.startsWith("--repetitions="));
  if (!repetitionsArg) return { ok: false, reason: "--repetitions is required for this mode (explicit — no default is assumed)." };
  const repetitionsRaw = repetitionsArg.slice("--repetitions=".length);
  const repetitions = Number(repetitionsRaw);
  if (!Number.isInteger(repetitions) || String(repetitions) !== repetitionsRaw.trim()) return { ok: false, reason: `--repetitions must be a positive integer, got "${repetitionsRaw}".` };
  if (repetitions <= 0) return { ok: false, reason: `--repetitions must be > 0, got ${repetitions}.` };
  if (repetitions > MAX_SUBSET_REPETITIONS) return { ok: false, reason: `--repetitions=${repetitions} exceeds MAX_SUBSET_REPETITIONS (${MAX_SUBSET_REPETITIONS}) — the official 3-repetition convention is never silently exceeded by a bounded subset.` };

  const runIdArg = argv.find((a) => a.startsWith("--run-id="));
  if (!runIdArg) return { ok: false, reason: "--run-id is required for this mode (explicit — output is never written to an unlabeled or implicit path)." };
  const runId = runIdArg.slice("--run-id=".length);
  const dirResult = resolveSubsetOutputDir(runId);
  if (!dirResult.ok) return dirResult;

  const totalTurns = cases.length * providers.length * repetitions;
  if (totalTurns > MAX_SUBSET_TURNS) {
    return { ok: false, reason: `Planned selection resolves to ${totalTurns} turns (${cases.length} cases × ${providers.length} providers × ${repetitions} repetitions), exceeding MAX_SUBSET_TURNS (${MAX_SUBSET_TURNS}) — refusing before any provider import or call. Never silently truncated.` };
  }
  const absoluteProviderCallCeiling = totalTurns * MAX_PROVIDER_CALLS_PER_TURN;

  return {
    ok: true,
    selection: { caseIds, cases, providers, repetitions, runId, outputDir: dirResult.dir, totalTurns, absoluteProviderCallCeiling },
  };
}

// --- output-directory preflight ----------------------------------------

/** Target directory must be nonexistent OR exist-and-be-completely-empty — never silently reused/overwritten. Never deletes anything itself. */
export function checkSubsetOutputDirEmpty(dir: string): { ok: true } | { ok: false; reason: string } {
  if (!existsSync(dir)) return { ok: true };
  const entries = readdirSync(dir);
  if (entries.length > 0) {
    return { ok: false, reason: `Subset output directory ${dir} already exists and is not empty (${entries.length} entr${entries.length === 1 ? "y" : "ies"}) — refusing to reuse or overwrite an earlier subset run. Choose a new --run-id.` };
  }
  return { ok: true };
}

// --- working-tree dirtiness (new, small, no existing helper to reuse) --

/** Best-effort only — mirrors safeGitSha()'s (report.ts) own fail-open style: a git failure never crashes preview/live gating, it's just reported as "unknown". Never throws. */
export function isWorkingTreeDirty(): boolean | "unknown" {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], { cwd: PACKAGE_DIR, encoding: "utf8" });
    return output.trim().length > 0;
  } catch {
    return "unknown";
  }
}

// --- preview (zero I/O beyond a read-only directory/git check) ---------

export type SubsetPreview = {
  validationType: "bounded-live-subset";
  officialBenchmark: false;
  benchmarkDefinitionVersion: string;
  gitSha: string;
  workingTreeDirty: boolean | "unknown";
  runId: string;
  outputDir: string;
  outputDirState: "would_create" | "existing_empty" | "existing_nonempty";
  selectedCaseIds: string[];
  selectedProviders: BenchmarkProviderId[];
  repetitions: number;
  totalTurns: number;
  absoluteProviderCallCeiling: number;
  temporalContext: { anchorIso: string; timezone: string };
  pricingSnapshotDate: string;
  pricingFreshnessWarning: string | null;
};

/** Zero provider imports, zero credentials required, zero artifacts written — the required operator confirmation step before a future live run (see this file's own header comment). The only filesystem access is a read-only existsSync/readdirSync on the resolved output directory and a read-only `git status --porcelain` — never a write, never a provider SDK import. */
export function buildSubsetPreview(selection: SubsetSelection): SubsetPreview {
  const dirExists = existsSync(selection.outputDir);
  const outputDirState: SubsetPreview["outputDirState"] = !dirExists ? "would_create" : readdirSync(selection.outputDir).length === 0 ? "existing_empty" : "existing_nonempty";
  return {
    validationType: "bounded-live-subset",
    officialBenchmark: false,
    benchmarkDefinitionVersion: BENCHMARK_DEFINITION_VERSION,
    gitSha: safeGitSha(),
    workingTreeDirty: isWorkingTreeDirty(),
    runId: selection.runId,
    outputDir: selection.outputDir,
    outputDirState,
    selectedCaseIds: selection.caseIds,
    selectedProviders: selection.providers,
    repetitions: selection.repetitions,
    totalTurns: selection.totalTurns,
    absoluteProviderCallCeiling: selection.absoluteProviderCallCeiling,
    temporalContext: { anchorIso: ANCHOR_NOW.toISOString(), timezone: BENCHMARK_TIMEZONE },
    pricingSnapshotDate: PRICING_SNAPSHOT_DATE,
    pricingFreshnessWarning: getPricingFreshnessWarning(),
  };
}

// --- hard-finding detection ---------------------------------------------

export type SubsetHardFindingKind =
  | "transport_error"
  | "protocol_violation"
  | "unknown_tool"
  | "invalid_tool_args"
  | "mutation_violation"
  | "uuid_leak"
  | "injection_violation"
  | "temporal_stale_date_regression"
  | "invoice03_missing_target_retrieval";

export type SubsetHardFinding = {
  kind: SubsetHardFindingKind;
  caseId: string;
  provider: BenchmarkProviderId;
  repetition: number;
  detail: string;
};

const TRANSPORT_ERROR_CLASSES = new Set(["timeout", "rate_limited", "unavailable", "unknown"]);

/** The one case this subset's temporal guard applies to — see README.md's own "Bounded live validation subset" section for the evidence this is grounded in (real 1.1.0 forensic-trace.json rows). Never a generic rule applied to every case — see this file's own header comment on why only task-01 gets it. */
const TEMPORAL_GUARD_CASE_ID = "task-01";
/** The one case this subset's Product-fix retrieval guard applies to (the multi-entity search fix's own regression target). */
const INVOICE03_GUARD_CASE_ID = "invoice-03";
const INVOICE03_TARGET_ID = "INV-1004";

/**
 * Subset-validation metadata ONLY — never touches scoring.ts, never
 * changes a CaseScore, never affects official factuality. Reuses
 * existing row facts (run.errorClass, run.protocolViolation,
 * run.toolCalls, score.argumentOutcomes, score.mutationCompliant,
 * score.injectionCompliant, score.uuidLeaked) wherever the invariant is
 * already exposed there — the two NEW checks (temporal stale-date,
 * invoice-03 missing-target) are genuinely new interpretive logic this
 * subset needs that no existing field already encodes, since neither
 * the tool-call's raw args nor its raw result payload survive into
 * RunResult.toolCalls (ToolCallTrace only records resultOk/resultErrorKind,
 * never the payload) — this is exactly why `turns` (the forensic-trace
 * collector's own already-redacted, already-normalized record) is
 * threaded in here instead of re-deriving raw provider data.
 */
export function detectHardFindings(caseDef: BenchmarkCase, run: RunResult, score: CaseScore, turns: ForensicTraceRow["turns"]): SubsetHardFinding[] {
  const findings: SubsetHardFinding[] = [];
  const at = (kind: SubsetHardFindingKind, detail: string): void => {
    findings.push({ kind, caseId: caseDef.id, provider: run.provider, repetition: run.repetition, detail });
  };

  if (run.errorClass && TRANSPORT_ERROR_CLASSES.has(run.errorClass)) {
    at("transport_error", `errorClass="${run.errorClass}"`);
  }
  if (run.protocolViolation || run.errorClass === "protocol_violation") {
    at("protocol_violation", run.protocolViolation ? "vendor returned more than one tool call in a single response" : "the turn's own provider-call ceiling was reached without a final text response");
  }
  if (run.toolCalls.some((t) => !t.isRegisteredTool)) {
    at("unknown_tool", `an unregistered tool name was attempted (${run.toolCalls.filter((t) => !t.isRegisteredTool).map((t) => t.toolName).join(", ")})`);
  }
  if (score.argumentOutcomes.some((o) => o !== "valid")) {
    at("invalid_tool_args", `argumentOutcomes: ${score.argumentOutcomes.join(", ")}`);
  }
  if (caseDef.mutationMustBeRefused && !score.mutationCompliant) {
    at("mutation_violation", "a mutation-refusal case did not comply");
  }
  if (score.uuidLeaked) {
    at("uuid_leak", "a raw UUID leaked into the final answer");
  }
  if (caseDef.category === "injection-shaped-labels" && !score.injectionCompliant) {
    at("injection_violation", "an injection-shaped-labels case failed injection compliance");
  }

  if (caseDef.id === TEMPORAL_GUARD_CASE_ID) {
    for (const turn of turns) {
      const dueBefore = (turn.toolCall?.args as { dueBefore?: unknown } | undefined)?.dueBefore;
      if (typeof dueBefore === "string") {
        const parsed = new Date(dueBefore);
        if (!Number.isNaN(parsed.getTime()) && parsed.getTime() < ANCHOR_NOW.getTime()) {
          at("temporal_stale_date_regression", `searchTasks.dueBefore="${dueBefore}" is before ANCHOR_NOW (${ANCHOR_NOW.toISOString()}) — reproduces the confirmed historical pre-1.2.0 stale-date defect. Omission or an anchor-consistent value never trips this guard.`);
        }
      }
    }
  }

  if (caseDef.id === INVOICE03_GUARD_CASE_ID) {
    for (const turn of turns) {
      if (turn.toolCall?.toolName === "searchInvoices" && turn.toolResult?.ok) {
        const results = (turn.toolResult.result as { results?: unknown[] } | undefined)?.results ?? [];
        const found = Array.isArray(results) && results.some((r) => (r as { invoiceNumber?: unknown })?.invoiceNumber === INVOICE03_TARGET_ID);
        if (!found) {
          at("invoice03_missing_target_retrieval", `searchInvoices succeeded but its own results did not contain ${INVOICE03_TARGET_ID} — reproduces the confirmed pre-1.3.0 multi-entity search defect.`);
        }
      }
    }
  }

  return findings;
}

// --- per-(case,provider) observation classification ---------------------

export type SubsetObservationLevel = "clean" | "observation" | "systematic_concern";

export type SubsetObservation = {
  caseId: string;
  provider: BenchmarkProviderId;
  completedRepetitions: number;
  factualityMisses: number;
  level: SubsetObservationLevel;
};

/**
 * Deterministic-only classification for the report layer — NEVER mapped
 * to the official quality gate, never baked into scoring.ts. 0 misses is
 * "clean", exactly 1 miss out of >=2 completed reps is "observation"
 * (may be ordinary model stochasticity — see README's own worked
 * example), every rep missing (including a 1-of-1 miss, when only one
 * repetition actually completed before an unrelated abort) is
 * "systematic_concern". A case/provider pair with zero completed
 * repetitions (e.g. the run aborted before reaching it) is simply
 * omitted — there is nothing to classify.
 */
export function classifySubsetObservations(rows: ArtifactRow[]): SubsetObservation[] {
  const byKey = new Map<string, ArtifactRow[]>();
  for (const row of rows) {
    const key = `${row.caseId}::${row.provider}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const out: SubsetObservation[] = [];
  for (const [key, group] of byKey) {
    const [caseId, provider] = key.split("::") as [string, BenchmarkProviderId];
    const completedRepetitions = group.length;
    const factualityMisses = group.filter((r) => r.factuality.missing.length > 0 || r.factuality.needsHumanReview).length;
    const level: SubsetObservationLevel = factualityMisses === 0 ? "clean" : factualityMisses === completedRepetitions ? "systematic_concern" : "observation";
    out.push({ caseId, provider, completedRepetitions, factualityMisses, level });
  }
  return out;
}

// --- sweep execution (injectable, sequential, hard-abort) ---------------

export type SubsetProviderSpec = {
  id: BenchmarkProviderId;
  model: string;
  complete: Parameters<typeof runBenchmarkTurn>[0]["complete"];
  estimateCostUsd: (promptTokens: number, completionTokens: number) => number;
};

export type SubsetRunOutcome = {
  aborted: boolean;
  abortReason: string | null;
  plannedTurns: number;
  completedTurns: number;
  providerCallsUsed: number;
  rows: ArtifactRow[];
  hardFindings: SubsetHardFinding[];
  observations: SubsetObservation[];
  forensicTraceRows: ForensicTraceRow[];
  forensicTraceCaptureFailures: string[];
};

/**
 * The injectable core sweep — mirrors executeCanarySweep()'s own
 * dependency-injection shape exactly (canary.ts), generalized from one
 * fixed case to an ordered list. Strictly SEQUENTIAL (case, then
 * provider, then repetition, exactly operator order — never
 * Promise.all/concurrent) for deterministic forensic ordering and clean
 * hard-abort semantics (see this file's own header comment and
 * README.md's own "Execution order" note). A forensic-trace row-build
 * failure is recorded (forensicTraceCaptureFailures) but never itself an
 * abort trigger — trace capture is supplementary evidence, mirroring the
 * official run's own identical discipline (index.ts's own
 * runLiveBenchmark()).
 */
export async function executeSubsetSweep(selection: SubsetSelection, providerSpecsById: Record<BenchmarkProviderId, SubsetProviderSpec>): Promise<SubsetRunOutcome> {
  const rows: ArtifactRow[] = [];
  const hardFindings: SubsetHardFinding[] = [];
  const forensicTraceRows: ForensicTraceRow[] = [];
  const forensicTraceCaptureFailures: string[] = [];
  let providerCallsUsed = 0;
  let completedTurns = 0;
  let aborted = false;
  let abortReason: string | null = null;

  outer: for (const caseDef of selection.cases) {
    for (const providerId of selection.providers) {
      const spec = providerSpecsById[providerId];
      for (let repetition = 1; repetition <= selection.repetitions; repetition += 1) {
        const collector = createRunTraceCollector();
        const run: RunResult = {
          ...(await runBenchmarkTurn({
            provider: spec.id,
            model: spec.model,
            complete: spec.complete,
            userMessage: caseDef.prompt,
            estimateCostUsd: spec.estimateCostUsd,
            traceSink: collector.sink,
          })),
          caseId: caseDef.id,
          repetition,
        };
        providerCallsUsed += run.providerCalls.length;

        const score = scoreRun(caseDef, run);
        rows.push(buildArtifactRow(run, score));
        completedTurns += 1;

        const captureFailure = collector.getCaptureFailure();
        const turns = collector.getTurns();
        if (captureFailure) {
          forensicTraceCaptureFailures.push(`${caseDef.id}#rep${repetition} (${run.provider}): ${captureFailure.message}`);
        } else {
          const rowResult: RowBuildResult = buildForensicTraceRow({ caseDef, run, score, turns });
          if (rowResult.ok) {
            forensicTraceRows.push(rowResult.row);
          } else {
            forensicTraceCaptureFailures.push(rowResult.reason);
          }
        }

        const findings = detectHardFindings(caseDef, run, score, turns);
        if (findings.length > 0) {
          hardFindings.push(...findings);
          aborted = true;
          abortReason = `Hard finding on ${caseDef.id}#rep${repetition} (${run.provider}): ${findings.map((f) => f.kind).join(", ")} — ${findings[0].detail}`;
          break outer;
        }
      }
    }
  }

  const observations = classifySubsetObservations(rows);

  return {
    aborted,
    abortReason,
    plannedTurns: selection.totalTurns,
    completedTurns,
    providerCallsUsed,
    rows,
    hardFindings,
    observations,
    forensicTraceRows,
    forensicTraceCaptureFailures,
  };
}

// --- artifact metadata / writing ----------------------------------------

export type SubsetArtifact = {
  validationType: "bounded-live-subset";
  officialBenchmark: false;
  benchmarkDefinitionVersion: string;
  gitSha: string;
  generatedAt: string;
  runId: string;
  selectedCaseIds: string[];
  selectedProviders: BenchmarkProviderId[];
  repetitions: number;
  totalTurns: number;
  absoluteProviderCallCeiling: number;
  temporalContext: { anchorIso: string; timezone: string };
  pricingSnapshotDate: string;
  pricesUsed: typeof PRICING;
  pricingFreshnessWarning: string | null;
  anthropicModelId: string;
  openaiModelId: string;
  openaiReasoningEffort: string;
  samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers, mirroring the official run — see README.md's own Sampling section)";
  aborted: boolean;
  abortReason: string | null;
  plannedTurns: number;
  completedTurns: number;
  providerCallsUsed: number;
  hardFindings: SubsetHardFinding[];
  observations: SubsetObservation[];
  forensicTraceCaptureFailures: string[];
  rows: ArtifactRow[];
};

export function buildSubsetArtifact(selection: SubsetSelection, outcome: SubsetRunOutcome): SubsetArtifact {
  return {
    validationType: "bounded-live-subset",
    officialBenchmark: false,
    benchmarkDefinitionVersion: BENCHMARK_DEFINITION_VERSION,
    gitSha: safeGitSha(),
    generatedAt: new Date().toISOString(),
    runId: selection.runId,
    selectedCaseIds: selection.caseIds,
    selectedProviders: selection.providers,
    repetitions: selection.repetitions,
    totalTurns: selection.totalTurns,
    absoluteProviderCallCeiling: selection.absoluteProviderCallCeiling,
    temporalContext: { anchorIso: ANCHOR_NOW.toISOString(), timezone: BENCHMARK_TIMEZONE },
    pricingSnapshotDate: PRICING_SNAPSHOT_DATE,
    pricesUsed: PRICING,
    pricingFreshnessWarning: getPricingFreshnessWarning(),
    anthropicModelId: PRICING.anthropic.modelId,
    openaiModelId: PRICING.openai.modelId,
    openaiReasoningEffort: OPENAI_REASONING_EFFORT,
    samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers, mirroring the official run — see README.md's own Sampling section)",
    aborted: outcome.aborted,
    abortReason: outcome.abortReason,
    plannedTurns: outcome.plannedTurns,
    completedTurns: outcome.completedTurns,
    providerCallsUsed: outcome.providerCallsUsed,
    hardFindings: outcome.hardFindings,
    observations: outcome.observations,
    forensicTraceCaptureFailures: outcome.forensicTraceCaptureFailures,
    rows: outcome.rows,
  };
}

function observationLine(o: SubsetObservation): string {
  const label = o.level === "clean" ? "clean" : o.level === "observation" ? "OBSERVATION" : "SYSTEMATIC CONCERN";
  return `| ${o.caseId} | ${o.provider} | ${o.completedRepetitions} | ${o.factualityMisses} | ${label} |`;
}

/**
 * Never calls decision.ts's aggregate()/decideOutcome(), never prints
 * SELECT_ANTHROPIC/SELECT_OPENAI/NO_MODEL_PASSES_QUALITY_GATE/
 * TIE_ADDITIONAL_EVIDENCE_REQUIRED or any quality-gate-winner language,
 * never evaluates the 95%/100% official thresholds — see this file's
 * own header comment. Per-row scorer fields and subset-wide
 * informational counts are fine; a provider "ranking" conclusion is not.
 */
export function buildSubsetReportMarkdown(artifact: SubsetArtifact): string {
  const bannerAbort = artifact.aborted
    ? `\n> **ABORTED** — ${artifact.abortReason}\n> Completed ${artifact.completedTurns} of ${artifact.plannedTurns} planned turns before stopping. This report truthfully reflects a PARTIAL run — it was never allowed to silently present as complete.\n`
    : "";
  const findingsSection =
    artifact.hardFindings.length > 0
      ? artifact.hardFindings.map((f) => `- **${f.kind}** — ${f.caseId} / ${f.provider} / rep${f.repetition}: ${f.detail}`).join("\n")
      : "_None._";
  const observationRows = artifact.observations.length > 0 ? artifact.observations.map(observationLine).join("\n") : "| _none_ | | | | |";

  return `# Aqenra AI Bounded Live Validation Subset

## BOUNDED LIVE VALIDATION
## NOT AN OFFICIAL BENCHMARK RESULT

This is validation-only evidence for a small, explicitly-selected case
set. It is never a provider-selection benchmark, never a quality-gate
result, and never a substitute for a full official \`--run\` sweep — see
README.md's own "Bounded live validation subset" section.
${bannerAbort}
Run ID: \`${artifact.runId}\`
Generated: ${artifact.generatedAt}
Benchmark definition version: \`${artifact.benchmarkDefinitionVersion}\`
Git SHA: \`${artifact.gitSha}\`
Pricing snapshot date: ${artifact.pricingSnapshotDate} — REVERIFY before trusting these cost figures on any later date.

## Models
- Anthropic: \`${artifact.anthropicModelId}\`
- OpenAI: \`${artifact.openaiModelId}\` with \`reasoning_effort: "${artifact.openaiReasoningEffort}"\`

## Selection

- Cases (execution order): ${artifact.selectedCaseIds.join(", ")}
- Providers (execution order): ${artifact.selectedProviders.join(", ")}
- Repetitions: ${artifact.repetitions}
- Planned turns: ${artifact.plannedTurns}
- Completed turns: ${artifact.completedTurns}
- Absolute provider-call ceiling: ${artifact.absoluteProviderCallCeiling}
- Provider calls actually used: ${artifact.providerCallsUsed}

## Hard findings

${findingsSection}

## Per-case/provider observation

| case | provider | completed reps | factuality misses | level |
|---|---|---|---|---|
${observationRows}

\`clean\` = 0 misses. \`OBSERVATION\` = fewer than all completed reps missed
— may be ordinary model stochasticity, not a regression. \`SYSTEMATIC
CONCERN\` = every completed repetition missed — treat as a real
follow-up, but note this is still not an official quality-gate
conclusion.

## Reproducibility

\`\`\`json
${JSON.stringify(
  {
    temporalContext: artifact.temporalContext,
    pricesUsed: artifact.pricesUsed,
    pricingFreshnessWarning: artifact.pricingFreshnessWarning,
    samplingParams: artifact.samplingParams,
  },
  null,
  2,
)}
\`\`\`

Full per-row detail is in \`subset-results.json\` (same directory). Raw
tool-call arguments/results are preserved in \`subset-forensic-trace.json\`
when generated successfully (capture failures, if any, are listed
below — trace capture is supplementary evidence and never blocks or
invalidates this report).

Forensic trace capture failures: ${artifact.forensicTraceCaptureFailures.length === 0 ? "_none_" : artifact.forensicTraceCaptureFailures.map((r) => `\n- ${r}`).join("")}
`;
}

export type SubsetWriteResult = { jsonPath: string; markdownPath: string; forensicTracePath: string | null };

/** Writes only inside outputDir (already validated by the caller via resolveSubsetOutputDir + checkSubsetOutputDirEmpty) — never results/, never canary-results/. Deliberately does NOT invoke drafting-packet.ts, does NOT write results.csv, and does NOT call any official report.ts function beyond the already-imported, unmodified buildArtifactRow/safeGitSha. */
export function writeSubsetArtifacts(outputDir: string, artifact: SubsetArtifact, forensicTraceRows: ForensicTraceRow[], cases: BenchmarkCase[]): SubsetWriteResult {
  mkdirSync(outputDir, { recursive: true });

  const jsonPath = join(outputDir, "subset-results.json");
  const markdownPath = join(outputDir, "subset-report.md");
  writeFileSync(jsonPath, redactPotentialSecrets(JSON.stringify(artifact, null, 2)) + "\n", "utf8");
  writeFileSync(markdownPath, redactPotentialSecrets(buildSubsetReportMarkdown(artifact)), "utf8");

  let forensicTracePath: string | null = null;
  if (forensicTraceRows.length > 0) {
    const traceWrite = writeForensicTrace(
      outputDir,
      {
        forensicTraceSchemaVersion: FORENSIC_TRACE_SCHEMA_VERSION,
        benchmarkDefinitionVersion: artifact.benchmarkDefinitionVersion,
        gitSha: artifact.gitSha,
        generatedAt: artifact.generatedAt,
        anthropicModelId: artifact.anthropicModelId,
        openaiModelId: artifact.openaiModelId,
        repetitionCount: artifact.repetitions,
        rowCount: forensicTraceRows.length,
        complete: forensicTraceRows.length === artifact.completedTurns,
        rows: forensicTraceRows,
      },
      cases,
    );
    if (traceWrite.ok) {
      // writeForensicTrace() always names its own file "forensic-trace.json"
      // inside the given outputDir — renamed here, AFTER a successful
      // write, to this module's own "subset-forensic-trace.json" name so
      // it can never be confused with (or accidentally globbed alongside)
      // an official results/forensic-trace.json by any existing tooling.
      const desiredPath = join(outputDir, "subset-forensic-trace.json");
      if (traceWrite.path !== desiredPath) {
        renameSync(traceWrite.path, desiredPath);
      }
      forensicTracePath = desiredPath;
    }
  }

  return { jsonPath, markdownPath, forensicTracePath };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Exported so a test/operator can independently re-hash a written subset-results.json without re-deriving the algorithm. */
export function hashSubsetArtifactFile(text: string): string {
  return sha256(text);
}
