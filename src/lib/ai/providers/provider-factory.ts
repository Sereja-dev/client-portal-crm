import "server-only";
import { TEST_MODE } from "@/lib/test-mode";
import type { AiProvider } from "../provider";
import type { MockAiScriptedStep } from "./mock";
import { MockAiProvider } from "./mock";
import { createUnconfiguredAiProvider } from "./unconfigured-provider";

/**
 * AI Assistant orchestration + Route Handler batch. The single resolver
 * the Route Handler calls to obtain an AiProvider — mirrors
 * src/lib/billing/provider/provider.ts's own resolver shape exactly:
 *
 *   1. TEST_MODE on -> MockAiProvider (deterministic, no network calls),
 *      constructed here with the one fixed script callers pass in (the
 *      Route Handler always passes the same small, fixed HTTP-contract
 *      script — see route.ts's own doc comment; there is no
 *      client-supplied "mockScenario" anywhere in this batch).
 *   2. Otherwise -> createUnconfiguredAiProvider(), which fails closed on
 *      every call. There is no real-provider branch in this batch at
 *      all — unlike billing's own provider.ts (which already has a real
 *      Paddle branch to fall through to before its own unconfigured
 *      case), this resolver has exactly two branches, because no real AI
 *      vendor adapter exists yet. A future, separate, explicitly-deferred
 *      batch adds a third branch here, the same way Paddle was added to
 *      billing's own resolver in a later stage than its own mock/
 *      unconfigured foundation.
 *
 * This is a deliberate, explained departure from billing's own "double
 * gate" pattern (MockBillingProvider itself also throws outside
 * TEST_MODE): MockAiProvider is NOT internally TEST_MODE-gated (three
 * already-merged unit-test files construct it directly with no TEST_MODE
 * set — see providers/mock.ts's own doc comment, unchanged by this
 * batch). The single gate here, at the factory, is sufficient:
 * MockAiProvider has no network/mutation capability of its own to make
 * "reachable by accident" dangerous the way a real billing charge would
 * be, and the Route Handler's own §20 fail-closed check (route.ts) is
 * the actual barrier against a Production request ever reaching this
 * factory's TEST_MODE branch (TEST_MODE is never "1" in Production — see
 * src/lib/test-mode.ts's own doc comment and
 * scripts/security-checks/check-no-test-mode.mjs).
 *
 * Importing this module, and calling either export below, must never make
 * a network call or read any provider-vendor env var — there is none to
 * read in this batch.
 */

/**
 * The Route Handler's own §A fail-closed gate calls this FIRST, before
 * auth/rate-limit/body-validation/orchestration — a cheap, synchronous,
 * side-effect-free boolean so a Production deployment (TEST_MODE always
 * false) can short-circuit to a generic 503 without a DB round-trip, an
 * auth check, or any other work. Deliberately just a boolean, not an
 * object carrying provider name/kind — route.ts's own 503 response must
 * never reveal TEST_MODE state or provider configuration detail (see
 * this batch's own §20 "important audit property"), and the caller has
 * no legitimate use for anything richer than "yes/no" here.
 */
export function isAiAssistantAvailable(): boolean {
  return TEST_MODE;
}

export function getAiProviderAdapter(scriptedSteps: MockAiScriptedStep[]): AiProvider {
  if (TEST_MODE) {
    return new MockAiProvider(scriptedSteps);
  }

  return createUnconfiguredAiProvider();
}
