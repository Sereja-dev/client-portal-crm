/**
 * Isolated Aqenra AI provider benchmark harness — report generation.
 *
 * Writes JSON + CSV + sanitized Markdown under results/ (gitignored — see
 * .gitignore's own /results/ entry; committed fixtures/cases are
 * unaffected). No API key, raw SDK request/response header, or real
 * customer content is ever written here — see secrets.ts's own
 * redactPotentialSecrets(), applied to every string field before it's
 * serialized.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseScore } from "./scoring.js";
import type { RunResult } from "./result-types.js";
import type { ProviderAggregate, SelectionOutcome } from "./decision.js";
import { redactPotentialSecrets } from "./secrets.js";
import { PRICING, PRICING_SNAPSHOT_DATE, getPricingFreshnessWarning } from "./pricing.js";
import { OPENAI_REASONING_EFFORT } from "./openai-compat.js";
import { BENCHMARK_DEFINITION_VERSION } from "./benchmark-version.js";
import { getAiAssistantSystemPrompt } from "../../src/lib/ai/system-prompt.js";
import { MAX_OUTPUT_TOKENS, MAX_PROVIDER_CALLS_PER_TURN, MAX_TOOL_CALLS_PER_TURN } from "../../src/lib/ai/orchestration-limits.js";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = join(PACKAGE_DIR, "results");

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Exported so index.ts's forensic-trace root (built before buildReproducibilityMetadata() runs, see forensic-trace.ts's own write-ordering doc comment) can record the identical gitSha value without a second, redundant `git rev-parse` subprocess call. */
export function safeGitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: PACKAGE_DIR, encoding: "utf8" }).trim();
  } catch {
    return "unknown — git rev-parse failed";
  }
}

function readSdkVersion(pkgRelativePath: string): string {
  try {
    const raw = readFileSync(join(PACKAGE_DIR, "node_modules", pkgRelativePath, "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "not installed";
  }
}

export type ReproducibilityMetadata = {
  gitSha: string;
  /**
   * Explicit benchmark CASE/SCORING semantics version (benchmark-version.ts)
   * — never derived from gitSha, which changes on every unrelated commit
   * too. Two runs are only safely comparable as one series if this value
   * matches; a run recorded before this field existed (the 2026-09-03
   * official run, results.json SHA-256
   * 450349e960c551f64c993fb104a4347eab459c027984da75107bf3ecf3aced0e) is
   * the implicit "1.0.0" predecessor and remains valid only under its
   * own, pre-grouped-scoring semantics — see benchmark-version.ts's own
   * history and README's own "Benchmark definition version" section.
   */
  benchmarkDefinitionVersion: string;
  benchmarkTimestamp: string;
  caseFileHash: string;
  toolContractSnapshotHash: string;
  systemPromptHash: string;
  anthropicModelId: string;
  openaiModelId: string;
  /**
   * The exact `reasoning_effort` value sent on every OpenAI Chat
   * Completions request in this run — a FROZEN, provider-specific
   * compatibility parameter (gpt-5.6-luna rejects `tools` on
   * /v1/chat/completions otherwise; see openai-compat.ts and README's
   * own "OpenAI reasoning effort" section). Recorded explicitly so an
   * official run's request shape is never implicit. There is no
   * Anthropic equivalent field — the Anthropic adapter's request is
   * unchanged and sends no reasoning/thinking parameter.
   */
  openaiReasoningEffort: string;
  pricingSnapshotDate: string;
  pricesUsed: typeof PRICING;
  repetitionCount: number;
  maxOutputTokens: number;
  maxToolCallsPerTurn: number;
  maxProviderCallsPerTurn: number;
  samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)";
  anthropicSdkVersion: string;
  openaiSdkVersion: string;
  officialRun: boolean;
  /** Non-null only when PRICING_SNAPSHOT_DATE is older than pricing.ts's own PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS — a WARNING only, never a refusal (see pricing.ts's own doc comment on why). Surfaced prominently in the Markdown report, never left buried in diagnostics-only output. */
  pricingFreshnessWarning: string | null;
  /**
   * Whether `--with-forensic-trace` was passed for this run (see
   * forensic-trace.ts / index.ts). `false` for every run that never
   * requested it — including every run recorded before this field
   * existed, and every offline/dry-run/validate invocation, which never
   * reach a live sweep at all. Purely observational: never affects
   * SelectionOutcome, scorer aggregates, cost, or provider request
   * sequence — see README.md's own "Forensic trace observability"
   * section.
   */
  forensicTraceEnabled: boolean;
  /**
   * "not_requested" unless `--with-forensic-trace` was passed. When it
   * was passed: "captured" once results/forensic-trace.json was
   * successfully validated and written, or "requested_but_failed" if
   * trace generation/validation/write failed for any reason — a failure
   * here NEVER invalidates this run's own official aggregate result
   * (results.json/report.md are written exactly as they would be
   * regardless), but must never be silently unrecorded either, since the
   * operator explicitly asked for this evidence.
   */
  forensicTraceStatus: "captured" | "requested_but_failed" | "not_requested";
};

export function buildReproducibilityMetadata(input: {
  repetitionCount: number;
  officialRun: boolean;
  forensicTraceEnabled?: boolean;
  forensicTraceStatus?: ReproducibilityMetadata["forensicTraceStatus"];
}): ReproducibilityMetadata {
  const casesSource = readFileSync(join(PACKAGE_DIR, "cases.ts"), "utf8");
  const snapshotSource = readFileSync(join(PACKAGE_DIR, "fixtures", "tool-contracts.snapshot.json"), "utf8");
  return {
    gitSha: safeGitSha(),
    benchmarkDefinitionVersion: BENCHMARK_DEFINITION_VERSION,
    benchmarkTimestamp: new Date().toISOString(),
    caseFileHash: sha256(casesSource),
    toolContractSnapshotHash: sha256(snapshotSource),
    systemPromptHash: sha256(getAiAssistantSystemPrompt()),
    anthropicModelId: PRICING.anthropic.modelId,
    openaiModelId: PRICING.openai.modelId,
    openaiReasoningEffort: OPENAI_REASONING_EFFORT,
    pricingSnapshotDate: PRICING_SNAPSHOT_DATE,
    pricesUsed: PRICING,
    repetitionCount: input.repetitionCount,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxToolCallsPerTurn: MAX_TOOL_CALLS_PER_TURN,
    maxProviderCallsPerTurn: MAX_PROVIDER_CALLS_PER_TURN,
    samplingParams: "vendor-default (temperature/top_p/top_k intentionally omitted for both providers — see README.md's own Sampling section)",
    anthropicSdkVersion: readSdkVersion("@anthropic-ai/sdk"),
    openaiSdkVersion: readSdkVersion("openai"),
    officialRun: input.officialRun,
    pricingFreshnessWarning: getPricingFreshnessWarning(),
    forensicTraceEnabled: input.forensicTraceEnabled ?? false,
    forensicTraceStatus: input.forensicTraceStatus ?? "not_requested",
  };
}

export type ArtifactRow = {
  caseId: string;
  repetition: number;
  provider: string;
  model: string;
  toolSequence: string[];
  toolArgumentOutcomes: string[];
  factuality: { confirmed: string[]; missing: string[]; needsHumanReview: boolean };
  mutationCompliance: boolean;
  injectionCompliance: boolean;
  uuidLeak: boolean;
  latencyMs: number;
  providerCallLatencies: number[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  errorClass: string | null;
  protocolViolation: boolean;
  needsHumanReview: boolean;
};

export function buildArtifactRow(run: RunResult, score: CaseScore): ArtifactRow {
  return {
    caseId: score.caseId,
    repetition: score.repetition,
    provider: run.provider,
    model: run.model,
    toolSequence: score.actualToolSequence,
    toolArgumentOutcomes: score.argumentOutcomes,
    factuality: { confirmed: score.keyFactsConfirmed, missing: score.keyFactsMissing, needsHumanReview: score.factualityNeedsHumanReview },
    mutationCompliance: score.mutationCompliant,
    injectionCompliance: score.injectionCompliant,
    uuidLeak: score.uuidLeaked,
    latencyMs: run.totalLatencyMs,
    providerCallLatencies: run.providerCalls.map((c) => c.latencyMs),
    promptTokens: run.totalUsage.promptTokens,
    completionTokens: run.totalUsage.completionTokens,
    totalTokens: run.totalUsage.totalTokens,
    estimatedCost: run.estimatedCostUsd,
    errorClass: run.errorClass,
    protocolViolation: run.protocolViolation,
    needsHumanReview: score.factualityNeedsHumanReview || score.clarificationNeedsHumanReview,
  };
}

/**
 * Neutralizes the classic CSV/spreadsheet formula-injection vector: a
 * cell whose content (after any leading whitespace) starts with
 * `=`, `+`, `-`, or `@` is interpreted as a formula by Excel/Sheets/
 * Numbers, not literal text. Applied unconditionally to every CSV cell
 * (see csvEscape() below) — not just toolSequence — since the only
 * cells that can ever actually start with one of these characters are
 * ones ultimately influenced by a model's own free-form choice (a tool
 * name it invents), and a leading apostrophe is a no-op for any cell
 * that doesn't start with one of them (caseId, provider, model, and the
 * closed-enum errorClass are all trusted/constrained strings that never
 * do). Deliberately checks the TRIMMED value's first character (leading
 * whitespace before a formula marker is still dangerous in real
 * spreadsheet software) but prefixes the ORIGINAL, untrimmed string, so
 * no content is silently dropped.
 */
export function sanitizeCsvCellForSpreadsheet(value: string): string {
  const trimmed = value.replace(/^\s+/, "");
  if (trimmed.length > 0 && /^[=+\-@]/.test(trimmed)) {
    return `'${value}`;
  }
  return value;
}

function csvEscape(value: unknown): string {
  const str = sanitizeCsvCellForSpreadsheet(redactPotentialSecrets(String(value)));
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(rows: ArtifactRow[]): string {
  const headers = [
    "caseId",
    "repetition",
    "provider",
    "model",
    "toolSequence",
    "latencyMs",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "estimatedCost",
    "mutationCompliance",
    "injectionCompliance",
    "uuidLeak",
    "protocolViolation",
    "errorClass",
    "needsHumanReview",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.caseId,
        row.repetition,
        row.provider,
        row.model,
        row.toolSequence.join(" > "),
        row.latencyMs.toFixed(1),
        row.promptTokens,
        row.completionTokens,
        row.totalTokens,
        row.estimatedCost.toFixed(6),
        row.mutationCompliance,
        row.injectionCompliance,
        row.uuidLeak,
        row.protocolViolation,
        row.errorClass ?? "",
        row.needsHumanReview,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function toMarkdown(input: {
  metadata: ReproducibilityMetadata;
  anthropic: ProviderAggregate;
  openai: ProviderAggregate;
  outcome: SelectionOutcome;
  anthropicGateFailures: string[];
  openaiGateFailures: string[];
}): string {
  const { metadata, anthropic, openai, outcome, anthropicGateFailures, openaiGateFailures } = input;
  const officialBanner = metadata.officialRun ? "" : "\n> **NON_OFFICIAL_RUN** — repetition count or another parameter was overridden from the default; this report does not represent the official 3-repetition comparison. See README.md's own \"Three repetitions\" section.\n";
  const pricingBanner = metadata.pricingFreshnessWarning ? `\n> **STALE_PRICING_WARNING** — ${metadata.pricingFreshnessWarning}\n` : "";
  return `# Aqenra AI Provider Benchmark Report
${officialBanner}${pricingBanner}
Generated: ${metadata.benchmarkTimestamp}
Benchmark definition version: \`${metadata.benchmarkDefinitionVersion}\` — see README.md's own "Benchmark definition version" section before comparing this report against any run recorded under a different version.
Git SHA: \`${metadata.gitSha}\`
Pricing snapshot date: ${metadata.pricingSnapshotDate} — REVERIFY before trusting these cost figures on any later date.
Forensic trace: ${metadata.forensicTraceEnabled ? `requested — status \`${metadata.forensicTraceStatus}\`` : "not requested for this run"} — see README.md's own "Forensic trace observability" section. Supplementary evidence only; this status never affects the outcome/aggregates above.

## Models
- Anthropic: \`${metadata.anthropicModelId}\` (no reasoning/thinking parameter sent — standard mode)
- OpenAI: \`${metadata.openaiModelId}\` with \`reasoning_effort: "${metadata.openaiReasoningEffort}"\` — a frozen Chat Completions compatibility requirement for this model when \`tools\` are present, and the fairness-symmetric setting vs the Anthropic arm (see README's own "OpenAI reasoning effort" section).

## Outcome

**${outcome}**

## Quality gate

| Provider | Passed | Failures |
|---|---|---|
| Anthropic | ${anthropicGateFailures.length === 0 ? "YES" : "NO"} | ${anthropicGateFailures.join("; ") || "—"} |
| OpenAI | ${openaiGateFailures.length === 0 ? "YES" : "NO"} | ${openaiGateFailures.join("; ") || "—"} |

## Aggregates

| Metric | Anthropic | OpenAI |
|---|---|---|
| Runs | ${anthropic.totalRuns} | ${openai.totalRuns} |
| Valid tool arguments | ${anthropic.validArgumentPct.toFixed(1)}% | ${openai.validArgumentPct.toFixed(1)}% |
| Factual correctness (deterministic cases) | ${anthropic.factualCorrectnessPct.toFixed(1)}% | ${openai.factualCorrectnessPct.toFixed(1)}% |
| Mutation-policy compliance | ${anthropic.mutationCompliancePct.toFixed(1)}% | ${openai.mutationCompliancePct.toFixed(1)}% |
| UUID no-leak rate | ${anthropic.uuidNoLeakPct.toFixed(1)}% | ${openai.uuidNoLeakPct.toFixed(1)}% |
| Unknown-tool executions | ${anthropic.unknownToolExecutionCount} | ${openai.unknownToolExecutionCount} |
| Injection violations | ${anthropic.injectionViolationCount} | ${openai.injectionViolationCount} |
| Protocol violations | ${anthropic.protocolViolationCount} | ${openai.protocolViolationCount} |
| Tool correctness score | ${anthropic.toolCorrectnessScore.toFixed(1)} | ${openai.toolCorrectnessScore.toFixed(1)} |
| Median latency | ${anthropic.medianLatencyMs.toFixed(0)}ms | ${openai.medianLatencyMs.toFixed(0)}ms |
| p90 latency | ${anthropic.p90LatencyMs.toFixed(0)}ms | ${openai.p90LatencyMs.toFixed(0)}ms |
| Total cost | $${anthropic.totalCostUsd.toFixed(4)} | $${openai.totalCostUsd.toFixed(4)} |

## Reproducibility

\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\`

Drafting cases (human-scored, blind) are written to \`results/drafting-blind-packet.json\` (vendor/model-free) alongside this report, generated automatically for every completed run. The real provider/model mapping lives separately in \`results/drafting-blind-mapping.json\` (gitignored, never linked from the scorer-visible packet).
`;
}

/**
 * `outputDir` defaults to the real, official `RESULTS_DIR` — every
 * production call site (index.ts's own `runLiveBenchmark()`) calls
 * `writeReport(input)` with no second argument, so official behavior is
 * byte-for-byte unchanged by this parameter's existence. It exists
 * SOLELY so tests can pass an isolated, per-test `mkdtempSync()`
 * directory instead — never an environment variable, never any other
 * form of implicit/hidden redirection, and nothing reads one to
 * override this default (see README.md's own "Test output isolation"
 * section for why: an env-var-driven override would itself be a route
 * for an untrusted variable to redirect where official artifacts land,
 * which is exactly the class of hazard this parameter is designed to
 * foreclose, not merely relocate).
 */
export function writeReport(
  input: {
    rows: ArtifactRow[];
    metadata: ReproducibilityMetadata;
    anthropic: ProviderAggregate;
    openai: ProviderAggregate;
    outcome: SelectionOutcome;
    anthropicGateFailures: string[];
    openaiGateFailures: string[];
  },
  outputDir: string = RESULTS_DIR,
): { jsonPath: string; csvPath: string; markdownPath: string } {
  mkdirSync(outputDir, { recursive: true });

  const jsonPath = join(outputDir, "results.json");
  const csvPath = join(outputDir, "results.csv");
  const markdownPath = join(outputDir, "report.md");

  const jsonPayload = JSON.stringify({ metadata: input.metadata, rows: input.rows, anthropic: input.anthropic, openai: input.openai, outcome: input.outcome }, null, 2);
  writeFileSync(jsonPath, redactPotentialSecrets(jsonPayload) + "\n", "utf8");
  writeFileSync(csvPath, toCsv(input.rows), "utf8");
  writeFileSync(markdownPath, redactPotentialSecrets(toMarkdown(input)), "utf8");

  return { jsonPath, csvPath, markdownPath };
}
