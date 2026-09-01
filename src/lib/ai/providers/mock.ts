import type { AiProvider, AiRequest, AiResponse, AiToolCall, AiUsage } from "../provider";
import { AiProviderError, type AiProviderErrorKind } from "../provider";

/**
 * AI Assistant Batch 1A. The only provider this batch (and every batch
 * through Batch 3's UI) ever uses — see the architecture plan's own
 * "mock-provider tests required" requirement and Batch 4's own scope note
 * that a real vendor adapter is a separate, later, explicitly-deferred
 * PR. Zero network access: every method below is a synchronous decision
 * over an in-memory, per-instance script queue, wrapped in a resolved/
 * rejected Promise purely to satisfy AiProvider's async signature — there
 * is no `fetch`, no environment variable read, no vendor SDK import
 * anywhere in this file (enforced by
 * scripts/security-checks/check-ai-assistant-security.mjs).
 *
 * Deliberately a class with per-instance state, not a module-level
 * mutable singleton (unlike test/support/auth-mock.ts's own
 * setMockAuthUser/resetAuthMock pair) — a provider is a dependency each
 * caller constructs and passes in, so two tests (or two concurrent
 * requests in a future orchestration layer) using their own
 * `new MockAiProvider(...)` can never leak scripted state into each
 * other, with no reset-between-tests discipline required.
 */

export type MockAiScriptedStep =
  | { kind: "text"; text: string; usage?: Partial<AiUsage> }
  | { kind: "toolCall"; call: AiToolCall; usage?: Partial<AiUsage> }
  | { kind: "error"; errorKind: AiProviderErrorKind };

/** Deterministic default usage figures — fixed, never randomized, so a test asserting on usage metadata never flakes. Any scripted step may override individual fields via its own partial `usage`. */
const DEFAULT_USAGE: AiUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

export class MockAiProvider implements AiProvider {
  // Explicitly declared (rather than simply omitted) so AiProvider's own
  // optional `stream` member is a real, typed `undefined` on every
  // instance — see this class's own doc comment for why no streaming
  // implementation exists in this batch.
  readonly stream: AiProvider["stream"] = undefined;

  private readonly steps: MockAiScriptedStep[];
  private cursor = 0;

  /** `steps` is consumed in order, one per `complete()` call — see `complete`'s own doc comment for what happens once they run out. */
  constructor(steps: MockAiScriptedStep[]) {
    this.steps = steps;
  }

  /**
   * Consumes the next scripted step. Throws a real, synchronous error
   * (never a silently-guessed default) if the script is exhausted —
   * matching this codebase's own consumeMockSignUpConfig()/
   * consumeMockSignInConfig() "must be configured before use" discipline
   * in test/support/auth-mock.ts, so a test that scripts too few turns
   * fails loudly at the exact call site that ran out, not with a
   * confusing downstream assertion failure.
   */
  async complete(request: AiRequest): Promise<AiResponse> {
    void request; // Interface conformance only — the mock's response is entirely script-driven, never a function of the request content.
    if (this.cursor >= this.steps.length) {
      throw new Error("MockAiProvider: script exhausted — no more scripted steps were configured for this call.");
    }
    const step = this.steps[this.cursor];
    this.cursor += 1;

    if (step.kind === "error") {
      throw new AiProviderError(step.errorKind);
    }

    const usage: AiUsage = { ...DEFAULT_USAGE, ...step.usage };

    if (step.kind === "text") {
      return { kind: "text", text: step.text, usage };
    }
    return { kind: "toolCall", call: step.call, usage };
  }

  // Intentionally no `stream` implementation — MVP orchestration is
  // non-streaming only (see provider.ts's own doc comment); a caller that
  // reaches for streaming against this mock gets undefined, the same
  // "not implemented" signal AiProvider's own optional-method shape
  // already gives for any adapter that doesn't support it.

  /** Test/introspection helper only — how many scripted steps remain unconsumed. Not part of the AiProvider interface. */
  remainingSteps(): number {
    return this.steps.length - this.cursor;
  }
}
