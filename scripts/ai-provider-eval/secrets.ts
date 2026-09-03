/**
 * Isolated Aqenra AI provider benchmark harness — secret handling.
 *
 * Reads ONLY AQENRA_EVAL_ANTHROPIC_API_KEY / AQENRA_EVAL_OPENAI_API_KEY —
 * deliberately distinct names from any future Production adapter's own
 * env vars, and NO fallback to ANTHROPIC_API_KEY/OPENAI_API_KEY, so this
 * harness can never accidentally reuse an unrelated developer or
 * Production credential a developer happens to have set in their shell
 * for some other tool (see README.md's own "Secret handling" section).
 *
 * A missing key is a clean, local validation error raised BEFORE any
 * client is constructed or any network call is attempted — never a
 * confusing downstream 401 from the vendor. The key value itself is
 * never logged, returned in an error message, or written to any result
 * artifact — every function below returns/throws only a boolean or a
 * generic message, never the value.
 */

export class MissingEvalApiKeyError extends Error {
  constructor(envVarName: string) {
    super(
      `${envVarName} is not set. This benchmark never falls back to a generic ANTHROPIC_API_KEY/OPENAI_API_KEY — set ${envVarName} in your local shell only (never in a committed file) before running a live benchmark. See README.md.`,
    );
    this.name = "MissingEvalApiKeyError";
  }
}

export function getAnthropicEvalApiKey(): string {
  const value = process.env.AQENRA_EVAL_ANTHROPIC_API_KEY;
  if (!value || value.trim().length === 0) {
    throw new MissingEvalApiKeyError("AQENRA_EVAL_ANTHROPIC_API_KEY");
  }
  return value;
}

export function getOpenAiEvalApiKey(): string {
  const value = process.env.AQENRA_EVAL_OPENAI_API_KEY;
  if (!value || value.trim().length === 0) {
    throw new MissingEvalApiKeyError("AQENRA_EVAL_OPENAI_API_KEY");
  }
  return value;
}

export function hasAnthropicEvalApiKey(): boolean {
  return Boolean(process.env.AQENRA_EVAL_ANTHROPIC_API_KEY?.trim());
}

export function hasOpenAiEvalApiKey(): boolean {
  return Boolean(process.env.AQENRA_EVAL_OPENAI_API_KEY?.trim());
}

/** Defense-in-depth for report.ts/index.ts's own console output and result artifacts: strips anything that looks like a live key value out of a string before it's printed or written, in case a vendor SDK ever echoes a header/config value into an error message. Not a substitute for never passing the raw key to a logger in the first place (see every call site's own discipline) — a second, independent layer. */
export function redactPotentialSecrets(text: string): string {
  const anthropicKey = process.env.AQENRA_EVAL_ANTHROPIC_API_KEY;
  const openaiKey = process.env.AQENRA_EVAL_OPENAI_API_KEY;
  let redacted = text;
  if (anthropicKey && anthropicKey.length >= 8) {
    redacted = redacted.split(anthropicKey).join("[REDACTED_ANTHROPIC_KEY]");
  }
  if (openaiKey && openaiKey.length >= 8) {
    redacted = redacted.split(openaiKey).join("[REDACTED_OPENAI_KEY]");
  }
  return redacted;
}
