import "server-only";
import { TEST_MODE } from "@/lib/test-mode";
import type { AiProvider } from "../provider";
import type { MockAiScriptedStep } from "./mock";
import { MockAiProvider } from "./mock";
import { createUnconfiguredAiProvider } from "./unconfigured-provider";
import { getOpenAiProviderConfig } from "./openai-config";
import { createOpenAiProvider } from "./openai";

/**
 * AI Assistant orchestration + Route Handler batch. The single resolver
 * the Route Handler calls to obtain an AiProvider — mirrors
 * src/lib/billing/provider/provider.ts's own resolver shape exactly:
 *
 *   1. TEST_MODE on -> MockAiProvider (deterministic, no network calls),
 *      constructed here with the one fixed script callers pass in — see
 *      route.ts's own doc comment. Takes priority over a real OpenAI
 *      config even if one happens to be present in the environment, so a
 *      local/test environment can never accidentally make a real request
 *      just because AI_PROVIDER/AQENRA_OPENAI_API_KEY also happen to be
 *      set for some other reason (same reasoning billing's own resolver
 *      already documents for TEST_MODE vs. a real Paddle config).
 *   2. Otherwise, getOpenAiProviderConfig() (./openai-config.ts) — the
 *      single source of truth for whether AI_PROVIDER/
 *      AQENRA_OPENAI_API_KEY are both present and valid. `"configured"`
 *      -> the real createOpenAiProvider(apiKey). This module itself never
 *      reads either env var directly, and never constructs a config
 *      object of its own — the exact apiKey getOpenAiProviderConfig()
 *      returns is the only thing ever passed to createOpenAiProvider, so
 *      there is no path to a partially-configured or hand-assembled real
 *      adapter.
 *   3. Any other case (`"disabled"` — AI_PROVIDER absent/not exactly
 *      "openai" — or `"misconfigured"` — AI_PROVIDER="openai" but the key
 *      is missing) -> createUnconfiguredAiProvider() is never called with
 *      anything; the resolver falls through to it, which fails closed on
 *      every call (see that file's own header comment).
 *
 * PRODUCTION FAIL-CLOSED, unchanged by this batch: this app's Production
 * deployment sets neither AI_PROVIDER nor AQENRA_OPENAI_API_KEY today (this
 * batch never touches Production env), so getOpenAiProviderConfig()
 * resolves "disabled" there exactly as before this file gained a real
 * branch — Production stays disabled by default, capable of being turned
 * on later only by an operator explicitly setting both vars, a decision
 * deliberately left outside this batch's own scope.
 *
 * Importing this module must never throw or fail at import time, and
 * calling getAiProviderAdapter()/isAiAssistantAvailable() must never make
 * a network call — getOpenAiProviderConfig() only reads process.env (no
 * I/O), and createOpenAiProvider's own OpenAI SDK client constructor only
 * stores the api key/options and builds resource wrappers (no fetch/await
 * anywhere in it, confirmed against the SDK's own source, the same
 * property billing's own createPaddleSdkClient doc comment already
 * establishes for that vendor) — every actual OpenAI API request happens
 * lazily, later, only when complete() is actually called by
 * orchestrate.ts's own loop.
 */

/**
 * The Route Handler's own §A fail-closed gate calls this FIRST, before
 * auth/rate-limit/body-validation/orchestration — cheap, synchronous,
 * side-effect-free, so a deployment with no real provider configured
 * (TEST_MODE always false, AI_PROVIDER unset) can short-circuit to a
 * generic 503 without a DB round-trip, an auth check, or any other work.
 * Deliberately just a boolean, not an object carrying provider name/kind
 * — route.ts's own 503 response must never reveal TEST_MODE state or
 * provider configuration detail, and the caller has no legitimate use for
 * anything richer than "yes/no" here.
 */
export function isAiAssistantAvailable(): boolean {
  if (TEST_MODE) return true;
  return getOpenAiProviderConfig().status === "configured";
}

export function getAiProviderAdapter(scriptedSteps: MockAiScriptedStep[]): AiProvider {
  if (TEST_MODE) {
    return new MockAiProvider(scriptedSteps);
  }

  const config = getOpenAiProviderConfig();
  if (config.status === "configured") {
    return createOpenAiProvider(config.apiKey);
  }

  return createUnconfiguredAiProvider();
}
