import type { AiProvider, AiRequest, AiResponse } from "../provider";
import { AiProviderError } from "../provider";

/**
 * AI Assistant orchestration + Route Handler batch. Mirrors
 * src/lib/billing/provider/unconfigured-provider.ts's own established
 * shape exactly: the adapter every non-TEST_MODE environment resolves to
 * until a real provider adapter is deliberately added in a later, separate
 * batch (there is no real-provider branch in provider-factory.ts at all
 * yet — see that file's own doc comment).
 *
 * Satisfies AiProvider in full. Every method fails closed and loudly:
 * `complete()` always rejects with AiProviderError("unavailable"),
 * `stream` is left undefined (identical to how MockAiProvider itself
 * leaves it undefined — see providers/mock.ts). No network call, no env
 * read, no vendor SDK import anywhere in this file.
 *
 * This is a defense-in-depth backstop, not the primary safety mechanism:
 * the real barrier is that the Route Handler checks provider availability
 * before doing anything else (see src/app/api/ai/assistant/route.ts) and
 * returns its own generic 503 without ever calling orchestrate.ts, so
 * this adapter's complete() is not expected to ever actually run in
 * normal operation — it exists so a future call site that forgets that
 * check still fails safely instead of silently producing a fabricated
 * answer.
 */
export function createUnconfiguredAiProvider(): AiProvider {
  return {
    providerId: "unconfigured",
    modelId: "unconfigured",
    stream: undefined,
    async complete(request: AiRequest, options?: { signal?: AbortSignal }): Promise<AiResponse> {
      void request; // Interface conformance only — this adapter never actually runs in normal operation (see this file's own header comment).
      void options;
      throw new AiProviderError("unavailable");
    },
  };
}
