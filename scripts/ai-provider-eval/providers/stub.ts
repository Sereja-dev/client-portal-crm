/**
 * Isolated Aqenra AI provider benchmark harness — offline stub provider.
 *
 * Used ONLY by index.ts's own --dry-run / --validate modes (and by
 * test/loop.test.ts) to exercise the full loop -> scoring -> report
 * pipeline with zero network access and zero SDK dependency — this file
 * imports neither `@anthropic-ai/sdk` nor `openai`, and constructs
 * nothing that could reach a real host. It always answers immediately
 * with a fixed placeholder text response, so a dry run's own quality
 * metrics are expected to show missing facts/failures — that's fine and
 * intentional: a dry run proves the pipeline WIRES together correctly
 * and makes no network call, never that the (never-invoked) real model
 * would score well.
 */

import type { AiRequest, AiResponse } from "../../../src/lib/ai/provider.js";
import type { NormalizedProviderTurn } from "../result-types.js";

const STUB_USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

export async function completeWithStub(request: AiRequest, options: { signal?: AbortSignal } = {}): Promise<NormalizedProviderTurn> {
  void request; // interface conformance only — the stub's response is fixed, never a function of the request (mirrors src/lib/ai/providers/mock.ts's own MockAiProvider.complete() discipline)
  void options;
  const response: AiResponse = {
    kind: "text",
    text: "[dry-run stub response — no real provider was called]",
    usage: STUB_USAGE,
  };
  return { kind: "ok", response };
}
