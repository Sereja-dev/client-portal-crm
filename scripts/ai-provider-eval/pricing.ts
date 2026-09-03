/**
 * Isolated Aqenra AI provider benchmark harness — pricing snapshot.
 *
 * Static, hand-verified, first-party-sourced prices — NEVER fetched
 * dynamically at benchmark-run time (a live pricing fetch would itself
 * be an unreviewed, non-allowlisted network call, and prices must stay
 * fixed for a single official run's own cost figures to mean anything).
 *
 * REVERIFY BOTH PRICES AND BOTH MODEL IDS AGAINST CURRENT FIRST-PARTY
 * VENDOR DOCS BEFORE EVERY LIVE BENCHMARK RUN — see README.md's own
 * "Model IDs and pricing must be reverified before every run" section.
 * This file being stale is not a crash; it is a silent cost-estimate
 * error, which is why every report artifact (see report.ts) prints
 * PRICING_SNAPSHOT_DATE prominently rather than assuming a reader will
 * check this file's own git history.
 */

export const PRICING_SNAPSHOT_DATE = "2026-09-03";

export const ANTHROPIC_MODEL_ID = "claude-haiku-4-5-20251001";
export const OPENAI_MODEL_ID = "gpt-5.6-luna";

/** USD per 1,000,000 tokens, first-party-verified on PRICING_SNAPSHOT_DATE (see the provider-selection research task's own source citations — platform.claude.com/docs/en/about-claude/pricing and developers.openai.com/api/docs/pricing). Cached-input prices are recorded for diagnostic completeness only; this harness's own cost estimate (pricing.ts's estimateCostUsd) uses only the base input/output rates, since neither vendor is asked to cache anything in this benchmark (no repeated system prompt/tool-definition reuse across the 216 independent runs is assumed cached). */
export const PRICING = {
  anthropic: {
    modelId: ANTHROPIC_MODEL_ID,
    inputPerMillionUsd: 1.0,
    outputPerMillionUsd: 5.0,
    cachedInputPerMillionUsd: 0.1,
    /** First-party-documented tool-use system-prompt overhead for Claude Haiku 4.5 under tool_choice "auto"/"none" — added to every request's own reported prompt tokens when estimating cost, since the vendor's own `usage.input_tokens` already includes it (this constant exists for report-time transparency, not to be double-added). */
    toolUseSystemPromptTokensAuto: 496,
  },
  openai: {
    modelId: OPENAI_MODEL_ID,
    inputPerMillionUsd: 0.2,
    outputPerMillionUsd: 1.2,
    cachedInputPerMillionUsd: 0.02,
  },
} as const;

export function estimateAnthropicCostUsd(promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1_000_000) * PRICING.anthropic.inputPerMillionUsd + (completionTokens / 1_000_000) * PRICING.anthropic.outputPerMillionUsd;
}

export function estimateOpenAiCostUsd(promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1_000_000) * PRICING.openai.inputPerMillionUsd + (completionTokens / 1_000_000) * PRICING.openai.outputPerMillionUsd;
}

/**
 * A pricing/model snapshot older than this is a WARNING, never a
 * refusal — the official benchmark refuses to run for exactly one
 * reason (a stale tool-contract snapshot; see snapshot-freshness.ts),
 * and pricing staleness is deliberately not elevated to that same hard
 * gate: stale prices produce a misleading cost *estimate*, not an unsafe
 * or invalid run (the quality-gate/tie-rule/selection outcome itself
 * does not depend on absolute cost accuracy in the way it depends on,
 * say, mutation compliance). 30 days is a reasonable, documented
 * default for "vendor pricing pages may plausibly have moved" — no
 * existing repo convention dictated a different number.
 */
export const PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS = 30;

/**
 * Returns a loud, human-readable warning string if PRICING_SNAPSHOT_DATE
 * is older than the threshold, or `null` if it's still fresh. Never
 * throws, never refuses — see this constant's own doc comment above for
 * why staleness here is surfaced, not enforced.
 */
export function getPricingFreshnessWarning(now: Date = new Date()): string | null {
  const snapshotDate = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00.000Z`);
  const ageMs = now.getTime() - snapshotDate.getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (ageDays <= PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS) {
    return null;
  }
  return `Pricing/model metadata is ${ageDays} days old (snapshot date ${PRICING_SNAPSHOT_DATE}, threshold ${PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS} days) and must be manually reverified against current first-party vendor docs before treating this run as an official provider-selection benchmark.`;
}
