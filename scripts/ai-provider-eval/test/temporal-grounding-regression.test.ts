import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { AiRequest } from "../../../src/lib/ai/provider.js";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import { BENCHMARK_CASES } from "../cases.js";

/**
 * Regression test for the 2026-09-20 failure-attribution audit's own
 * finding: task-01 ("What tasks are due soon, in the next couple of
 * weeks?") and task-03 ("List the tasks that are overdue.") — both
 * date-relative — produced live model-constructed `dueBefore` values
 * around 2024/2025, when the benchmark's own fixture anchor is
 * 2026-09-01, because the provider-visible system prompt carried no
 * authoritative "today" at all.
 *
 * This test does NOT call a model and does NOT parse/interpret any
 * model output — it only proves, at the prompt-CONSTRUCTION layer, that
 * the information a model would need to avoid that specific failure mode
 * (an authoritative current date matching the fixture's own anchor) is
 * now genuinely present in the exact request a real provider call would
 * receive for these two cases. Whether a model actually uses it correctly
 * is a live-benchmark question, never claimed or guaranteed here.
 */

const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

function capturingComplete(): { complete: ProviderCompleteFn; requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  const complete: ProviderCompleteFn = async (request) => {
    requests.push(request);
    return { kind: "ok", response: { kind: "text", text: "placeholder", usage: USAGE } };
  };
  return { complete, requests };
}

describe("temporal-grounding regression — task-01/task-03's own real prompts", () => {
  for (const caseId of ["task-01", "task-03"]) {
    test(`${caseId}'s own provider-visible request now carries the authoritative 2026-09-01 anchor`, async () => {
      const caseDef = BENCHMARK_CASES.find((c) => c.id === caseId);
      assert.ok(caseDef, `case "${caseId}" must exist in cases.ts`);

      const { complete, requests } = capturingComplete();
      await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: caseDef!.prompt, estimateCostUsd: () => 0 });

      const systemPrompt = requests[0].systemPrompt;
      assert.match(
        systemPrompt,
        /2026-09-01/,
        `${caseId}'s own request must carry the fixture's real anchor date, not leave the model to guess a "today" that could land in 2024/2025 as observed in the archived 1.1.0 live run`,
      );
      assert.match(systemPrompt, /UTC/, `${caseId}'s own request must also carry an explicit, authoritative timezone`);
    });
  }
});
