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
