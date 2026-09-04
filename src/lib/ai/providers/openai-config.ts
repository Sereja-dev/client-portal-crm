import "server-only";

/**
 * AI Assistant — real OpenAI provider integration. Reads and validates
 * the real-provider env vars this batch introduces, and nothing else —
 * no network call, no SDK import, no API request required to exist.
 * Mirrors src/lib/billing/provider/paddle-config.ts's own shape exactly
 * (see that file's own header comment): a single, already-tested place
 * every caller gets its validated configuration from, rather than each
 * adapter/route re-reading and re-validating `process.env` independently.
 *
 * Two env vars, both server-only by design (never a NEXT_PUBLIC_ prefix):
 *   - AI_PROVIDER          — must be exactly "openai" to enable anything;
 *                            absent, empty, or any other value (including
 *                            the explicit literal "disabled") means
 *                            disabled. There is no default-on state.
 *   - AQENRA_OPENAI_API_KEY — the real OpenAI API key. Deliberately NOT
 *                            named `OPENAI_API_KEY`: this app must never
 *                            silently pick up an unrelated key a
 *                            developer happens to have set in their shell
 *                            for some other tool (mirrors
 *                            scripts/ai-provider-eval/secrets.ts's own
 *                            AQENRA_EVAL_*_API_KEY naming discipline,
 *                            deliberately a DIFFERENT var name from that
 *                            isolated benchmark harness's own — this is
 *                            the real Production adapter's own, separate
 *                            credential).
 *
 * Three possible outcomes, deliberately distinguished (unlike
 * getPaddleProviderConfig()'s own uniform `null` for "any invalid
 * reason") — see this module's own doc comment on getOpenAiProviderConfig()
 * below for exactly why:
 *   - "disabled": AI_PROVIDER is absent or not exactly "openai". This is
 *     the default, safe, expected state for every environment that
 *     hasn't explicitly opted in — including Production today (this
 *     batch never sets either var there — see provider-factory.ts's own
 *     doc comment).
 *   - "misconfigured": AI_PROVIDER is exactly "openai" but
 *     AQENRA_OPENAI_API_KEY is missing/empty/whitespace-only — a
 *     deterministic configuration failure, not silently collapsed into
 *     "disabled". An operator who explicitly opted in but forgot the key
 *     gets a distinct, diagnosable state (see provider-factory.ts's own
 *     resolver, which still fails closed to the same unconfigured
 *     adapter either way — the distinction exists for observability, not
 *     to change the fail-closed outcome).
 *   - "configured": both are present and valid — the real adapter may be
 *     constructed.
 *
 * Key presence ALONE never enables anything: AQENRA_OPENAI_API_KEY is
 * only ever consulted after AI_PROVIDER has already been confirmed to
 * equal "openai" exactly.
 */

export type OpenAiProviderConfigResult =
  | { status: "disabled" }
  | { status: "misconfigured" }
  | { status: "configured"; apiKey: string };

function trimmedEnv(name: string): string | null {
  const value = process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Never throws, never makes a network call, never reads a generic
 * `OPENAI_API_KEY` fallback. See this module's own header comment for
 * the exact three-outcome contract.
 */
export function getOpenAiProviderConfig(): OpenAiProviderConfigResult {
  const providerSetting = trimmedEnv("AI_PROVIDER");
  if (providerSetting !== "openai") {
    return { status: "disabled" };
  }

  const apiKey = trimmedEnv("AQENRA_OPENAI_API_KEY");
  if (!apiKey) {
    return { status: "misconfigured" };
  }

  return { status: "configured", apiKey };
}
