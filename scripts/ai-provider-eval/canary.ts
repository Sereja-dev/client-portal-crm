import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchmarkCase } from "./cases.js";
import { runBenchmarkTurn } from "./loop.js";
import { scoreRun, type CaseScore } from "./scoring.js";
import { redactPotentialSecrets } from "./secrets.js";
import { safeGitSha } from "./report.js";
import { BENCHMARK_DEFINITION_VERSION } from "./benchmark-version.js";
import type { BenchmarkProviderId, RunResult } from "./result-types.js";

/**
 * Isolated Aqenra AI provider benchmark harness — the injectable core of
 * the bounded live protocol canary (index.ts's own `--canary` mode; see
 * README.md's own "Live protocol canary" section).
 *
 * Deliberately its OWN module, separate from index.ts, for one specific
 * reason: index.ts has a top-level, unconditional `main().catch(...)`
 * call (see that file's own header comment) — importing index.ts from
 * anywhere, including a test file, would execute that call as an import
 * side effect. Every existing test in this package that needs CLI-level
 * behavior therefore spawns a real `npx tsx index.ts ...` subprocess
 * instead of importing index.ts directly (see test/no-live-by-default.test.ts,
 * test/freshness-ordering.test.ts, test/results-dir-preflight.test.ts).
 * That technique cannot exercise this module's OWN classification/
 * sweep-orchestration logic with injected fake providers, so the
 * sweep/classification/artifact-writing logic lives here instead, in a
 * module with no top-level side effect of its own — test/canary.test.ts
 * imports directly from this file, never from index.ts.
 *
 * Bounded live protocol canary: exactly one fixed case (CANARY_CASE_ID),
 * one repetition, both providers, each capped at CANARY_MAX_PROVIDER_CALLS
 * provider calls — absolute maximum 4 live requests for the whole
 * invocation. Proves credentials/model IDs/request shape/tool-calling
 * round-trip are live-reachable, WITHOUT ever calling decision.ts's
 * aggregate()/decideOutcome() (no SelectionOutcome, no provider ranking,
 * no quality-gate evaluation) and WITHOUT ever calling report.ts's own
 * writeReport() (the official results/ directory is never referenced
 * anywhere in this file — see writeCanaryReport() below, which targets
 * CANARY_RESULT_PATH exclusively).
 */

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
export const CANARY_RESULTS_DIR = join(PACKAGE_DIR, "canary-results");
export const CANARY_RESULT_PATH = join(CANARY_RESULTS_DIR, "canary-result.json");
export const CANARY_CASE_ID = "org-summary-01";
export const CANARY_MAX_PROVIDER_CALLS = 2;

export type CanaryClassification = "PASS" | "PROTOCOL_FAILURE" | "TOOL_PROTOCOL_FAILURE" | "TRANSPORT_INCONCLUSIVE";
/**
 * The overall, top-of-invocation outcome a human/CI caller observes
 * (console output + process exit code). "CREDENTIAL_MISSING" and
 * "CANARY_CASE_NOT_FOUND" never reach writeCanaryReport() at all — both
 * are pre-provider-call failures that exit before any artifact is
 * written (see index.ts's own runCanary() early-return branches) — so
 * the JSON artifact's own `overall` field is always exactly "PASS" or
 * "FAIL".
 */
export type CanaryOverallClassification = "PASS" | "FAIL" | "CREDENTIAL_MISSING" | "CANARY_CASE_NOT_FOUND";

const CANARY_TRANSPORT_ERROR_CLASSES = new Set(["timeout", "rate_limited", "unavailable", "unknown"]);
const CANARY_DETERMINISTIC_REQUEST_ERROR_CLASSES = new Set(["invalid_request", "malformed_response"]);

export type CanaryProviderResult = {
  provider: BenchmarkProviderId;
  model: string;
  classification: CanaryClassification;
  providerCallCount: number;
  toolSelected: string | null;
  argumentOutcome: string | null;
  finalTextPresent: boolean;
  protocolViolation: boolean;
  uuidLeaked: boolean;
  errorClass: string | null;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

/**
 * Deterministic classification from an already-computed RunResult/
 * CaseScore — never re-scores, never re-runs. Mapping, documented exactly
 * once here (see README.md's own canary section for the human-readable
 * summary of the same rules):
 *   - a transport-class errorClass (timeout/rate_limited/unavailable/
 *     unknown) -> TRANSPORT_INCONCLUSIVE (never retried; see this
 *     package's own "no automatic retry" discipline, unchanged by this
 *     feature).
 *   - a deterministic request-shape errorClass (invalid_request/
 *     malformed_response), OR the vendor itself reported a
 *     protocol_violation (more than one tool call in one response,
 *     despite the single-call enforcement both adapters already send),
 *     OR a raw UUID leaked into the final answer (the produced answer
 *     didn't conform to the system prompt's own contract)
 *     -> PROTOCOL_FAILURE: the provider rejected, or its own response
 *     didn't conform to, the configured request/response contract.
 *   - the run's OWN ceiling was reached (errorClass === "protocol_violation"
 *     but run.protocolViolation is false — i.e. the model asked for a
 *     THIRD tool call instead of returning final text within
 *     CANARY_MAX_PROVIDER_CALLS), an unregistered tool was attempted, a
 *     tool call's own arguments were invalid, the actual tool sequence
 *     didn't exactly match the fixed case's own `expectedToolSequence`
 *     (score.fullSequenceMatch === false — covers a wrong-but-registered
 *     tool with valid arguments, no tool call at all before final text,
 *     and any extra/short sequence, not just an outright protocol error),
 *     or no final text was ever produced for any other reason
 *     -> TOOL_PROTOCOL_FAILURE: the raw request/response protocol itself
 *     worked, but the tool-calling round trip didn't converge the way
 *     this canary expects.
 *   - anything else -> PASS.
 * A raw UUID leak is folded into PROTOCOL_FAILURE rather than added as a
 * fifth classification, keeping this function's return type exactly the
 * four values the locked design specifies.
 *
 * The expected-tool-sequence check below is deliberately protocol-only,
 * never factuality-based: it reuses score.fullSequenceMatch (already
 * computed by the unmodified scoreRun()/scoreToolSelection(), comparing
 * run.toolCalls's own tool names against caseDef.expectedToolSequence —
 * never against expectedFactGroups/keyFactsConfirmed). A PASS therefore
 * still says nothing about answer quality, only that the fixed case's
 * required tool was actually called, once, exactly as expected — the one
 * guarantee this canary case exists to exercise. See
 * test/canary.test.ts's own "wrong-but-valid tool" and "no tool call"
 * adversarial cases for the exact scenarios this closes.
 */
export function classifyCanaryProviderResult(run: RunResult, score: CaseScore): CanaryClassification {
  if (run.errorClass && CANARY_TRANSPORT_ERROR_CLASSES.has(run.errorClass)) {
    return "TRANSPORT_INCONCLUSIVE";
  }
  if (run.errorClass && CANARY_DETERMINISTIC_REQUEST_ERROR_CLASSES.has(run.errorClass)) {
    return "PROTOCOL_FAILURE";
  }
  if (run.protocolViolation) {
    // The vendor itself returned more than one tool call in one response.
    return "PROTOCOL_FAILURE";
  }
  if (score.uuidLeaked) {
    return "PROTOCOL_FAILURE";
  }
  if (run.errorClass === "protocol_violation") {
    // Our own ceiling was reached without a final text response.
    return "TOOL_PROTOCOL_FAILURE";
  }
  if (run.toolCalls.some((t) => !t.isRegisteredTool)) {
    return "TOOL_PROTOCOL_FAILURE";
  }
  if (score.argumentOutcomes.some((outcome) => outcome !== "valid")) {
    return "TOOL_PROTOCOL_FAILURE";
  }
  if (!score.fullSequenceMatch) {
    // The actual tool-call sequence didn't exactly match the fixed
    // case's own expectedToolSequence — a wrong-but-registered tool with
    // valid arguments, no tool call at all, or an extra/short sequence.
    // Every one of those is otherwise indistinguishable from a genuine
    // protocol success by the checks above alone, which is exactly the
    // gap this check closes.
    return "TOOL_PROTOCOL_FAILURE";
  }
  if (run.finalText === null) {
    return "TOOL_PROTOCOL_FAILURE";
  }
  return "PASS";
}

function buildCanaryProviderResult(run: RunResult, score: CaseScore): CanaryProviderResult {
  return {
    provider: run.provider,
    model: run.model,
    classification: classifyCanaryProviderResult(run, score),
    providerCallCount: run.providerCalls.length,
    toolSelected: score.actualToolSequence[0] ?? null,
    argumentOutcome: score.argumentOutcomes[0] ?? null,
    finalTextPresent: run.finalText !== null,
    protocolViolation: run.protocolViolation,
    uuidLeaked: score.uuidLeaked,
    errorClass: run.errorClass,
    latencyMs: run.totalLatencyMs,
    promptTokens: run.totalUsage.promptTokens,
    completionTokens: run.totalUsage.completionTokens,
    totalTokens: run.totalUsage.totalTokens,
    estimatedCostUsd: run.estimatedCostUsd,
  };
}

/**
 * Writes the narrow, canary-only artifact — never ArtifactRow/
 * ReproducibilityMetadata/ProviderAggregate/SelectionOutcome, and never
 * through report.ts's own writeReport() (the official results/ directory
 * is never referenced anywhere in this file). Redacted the same way
 * every other artifact in this package is (secrets.ts's own
 * redactPotentialSecrets(), applied to the final serialized string) even
 * though nothing written here ever carries a raw secret to begin with —
 * defense in depth, matching report.ts's own identical discipline.
 *
 * `resultPath` defaults to the real CANARY_RESULT_PATH — index.ts's own
 * runCanary() (the only production call site) always calls this with no
 * second argument, so official behavior is byte-for-byte unchanged by
 * this parameter's existence. It exists SOLELY so tests can pass an
 * isolated path instead — mirrors report.ts's own writeReport(input,
 * outputDir) parameter exactly, including its own "never an environment
 * variable, never any other form of implicit redirection" discipline.
 */
export function writeCanaryReport(providers: CanaryProviderResult[], resultPath: string = CANARY_RESULT_PATH): { path: string; overall: CanaryOverallClassification } {
  // "FAIL" deliberately never names which provider(s) failed at this
  // top level — see this module's own "do not rank providers" discipline;
  // that detail lives entirely in each provider's own array entry.
  const overall: CanaryOverallClassification = providers.every((p) => p.classification === "PASS") ? "PASS" : "FAIL";
  const artifact = {
    runKind: "canary",
    benchmarkDefinitionVersion: BENCHMARK_DEFINITION_VERSION,
    gitSha: safeGitSha(),
    caseId: CANARY_CASE_ID,
    createdAt: new Date().toISOString(),
    maxProviderCallsPerProvider: CANARY_MAX_PROVIDER_CALLS,
    overall,
    providers,
  };
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, redactPotentialSecrets(JSON.stringify(artifact, null, 2)) + "\n", "utf8");
  return { path: resultPath, overall };
}

/** One provider's own injectable identity for executeCanarySweep() — mirrors the shape index.ts's own runLiveBenchmark() local `providers` array already uses, so canary and official-run provider construction share the same field names even though neither reuses the other's array. */
export type CanaryProviderSpec = {
  id: BenchmarkProviderId;
  model: string;
  complete: Parameters<typeof runBenchmarkTurn>[0]["complete"];
  estimateCostUsd: (promptTokens: number, completionTokens: number) => number;
};

/**
 * The injectable core of the canary: given the fixed case and an ordered
 * list of provider specs, runs exactly one runBenchmarkTurn per spec (in
 * array order — never reordered), each capped at CANARY_MAX_PROVIDER_CALLS,
 * classifies each, and returns both individual results plus the overall
 * PASS/FAIL. Never touches the filesystem, never imports a real vendor
 * SDK itself (the caller supplies `complete`) — this is what
 * test/canary.test.ts exercises directly with fake providers, the same
 * dependency-injection shape test/loop.test.ts's own `scripted()` helper
 * already establishes for runBenchmarkTurn. Always runs every spec,
 * regardless of an earlier one's outcome: the two providers are fully
 * independent evidence within one bounded authorization, and skipping a
 * later provider on an earlier failure would only force a second live
 * invocation to learn about it, for no safety benefit.
 */
export async function executeCanarySweep(caseDef: BenchmarkCase, providerSpecs: CanaryProviderSpec[]): Promise<{ providers: CanaryProviderResult[]; overall: "PASS" | "FAIL" }> {
  const results: CanaryProviderResult[] = [];
  for (const spec of providerSpecs) {
    console.log(`${spec.id} canary turn...`);
    const run: RunResult = {
      ...(await runBenchmarkTurn({
        provider: spec.id,
        model: spec.model,
        complete: spec.complete,
        userMessage: caseDef.prompt,
        estimateCostUsd: spec.estimateCostUsd,
        maxProviderCalls: CANARY_MAX_PROVIDER_CALLS,
      })),
      caseId: caseDef.id,
      repetition: 1,
    };
    const score = scoreRun(caseDef, run);
    const result = buildCanaryProviderResult(run, score);
    console.log(`${spec.id} canary turn -> ${result.classification} (${result.providerCallCount} provider call(s)).`);
    results.push(result);
  }
  const overall: "PASS" | "FAIL" = results.every((r) => r.classification === "PASS") ? "PASS" : "FAIL";
  return { providers: results, overall };
}
