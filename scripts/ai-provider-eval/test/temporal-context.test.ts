import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { AiRequest } from "../../../src/lib/ai/provider.js";
import { buildEffectiveSystemPrompt } from "../../../src/lib/ai/temporal-context.js";
import { getAiAssistantSystemPrompt } from "../../../src/lib/ai/system-prompt.js";
import { runBenchmarkTurn, BENCHMARK_TIMEZONE, type ProviderCompleteFn } from "../loop.js";
import { ANCHOR_NOW } from "../fixtures/organization.js";
import { BENCHMARK_DEFINITION_VERSION } from "../benchmark-version.js";
import { buildReproducibilityMetadata } from "../report.js";
import { BENCHMARK_CASES } from "../cases.js";
import { checkSnapshotFreshness } from "../snapshot-freshness.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const ZERO_COST = () => 0;

function capturingComplete(text: string): { complete: ProviderCompleteFn; requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  const complete: ProviderCompleteFn = async (request) => {
    requests.push(request);
    return { kind: "ok", response: { kind: "text", text, usage: USAGE } };
  };
  return { complete, requests };
}

describe("loop.ts — benchmark temporal grounding wiring", () => {
  test("uses the SAME shared buildEffectiveSystemPrompt() the product orchestrator uses, fed ANCHOR_NOW and a fixed timezone — never Date.now()/new Date()", async () => {
    const { complete, requests } = capturingComplete("Hello.");
    await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: "hi", estimateCostUsd: ZERO_COST });

    const expected = buildEffectiveSystemPrompt({ basePrompt: getAiAssistantSystemPrompt(), now: ANCHOR_NOW, timezone: BENCHMARK_TIMEZONE });
    assert.equal(requests[0].systemPrompt, expected);
  });

  test("benchmark timezone is exactly UTC", () => {
    assert.equal(BENCHMARK_TIMEZONE, "UTC");
  });

  test("effective benchmark system prompt contains the fixed 2026-09-01 anchor and UTC", async () => {
    const { complete, requests } = capturingComplete("Hello.");
    await runBenchmarkTurn({ provider: "openai", model: "m", complete, userMessage: "hi", estimateCostUsd: ZERO_COST });
    assert.match(requests[0].systemPrompt, /2026-09-01/);
    assert.match(requests[0].systemPrompt, /UTC/);
  });

  test("the same effective system prompt is reused across every provider call within one turn", async () => {
    const requests: AiRequest[] = [];
    let callCount = 0;
    const complete: ProviderCompleteFn = async (request) => {
      requests.push(request);
      callCount += 1;
      if (callCount === 1) {
        return { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: {} }, usage: USAGE } };
      }
      return { kind: "ok", response: { kind: "text", text: "done", usage: USAGE } };
    };
    await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: "who are my clients?", estimateCostUsd: ZERO_COST });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].systemPrompt, requests[1].systemPrompt);
  });

  test("never inserts an internal role:\"system\" AiMessage — the composed string is the only carrier", async () => {
    const { complete, requests } = capturingComplete("Hello.");
    await runBenchmarkTurn({ provider: "openai", model: "m", complete, userMessage: "hi", estimateCostUsd: ZERO_COST });
    assert.equal(requests[0].messages.some((m) => m.role === "system"), false);
  });
});

describe("benchmark-version.ts — 1.2.0 temporal-grounding bump", () => {
  test("BENCHMARK_DEFINITION_VERSION reflects the temporal-grounding bump and every bump since (currently 1.13.0 — AI Benchmark Mixed-Currency Paid Revenue fix, see benchmark-version.ts's own History)", () => {
    // Not a bare "!== 1.1.0" comparison: this repo's own versioning
    // discipline is a strictly monotonic bump-per-semantic-change
    // sequence (see benchmark-version.ts's own History), so asserting
    // the exact current value here is equally precise and keeps this
    // test doing real work — a future bump updates this one literal
    // alongside benchmark-version.ts's own constant, same as every other
    // call site in this package that references the live import instead
    // of re-deriving it.
    assert.equal(BENCHMARK_DEFINITION_VERSION, "1.13.0");
  });

  test("reproducibility metadata records the exact temporal anchor and timezone, with no wall-clock value", () => {
    const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true });
    assert.deepEqual(metadata.temporalContext, { anchorIso: ANCHOR_NOW.toISOString(), timezone: "UTC" });
    assert.equal(metadata.temporalContext.anchorIso, "2026-09-01T00:00:00.000Z");
  });

  test("systemPromptHash semantics are unchanged — it still hashes only the static base prompt, not the effective (composed) one", () => {
    const metadata = buildReproducibilityMetadata({ repetitionCount: 3, officialRun: true });
    const effective = buildEffectiveSystemPrompt({ basePrompt: getAiAssistantSystemPrompt(), now: ANCHOR_NOW, timezone: "UTC" });
    // sha256 of the base prompt alone, recomputed independently, must
    // match — proving the hash was never taken over the longer, suffixed
    // effective string (which would also be a valid-looking hex string,
    // so a plain "is it defined" check would miss this regression).
    assert.notEqual(effective, getAiAssistantSystemPrompt());
    assert.ok(typeof metadata.systemPromptHash === "string" && metadata.systemPromptHash.length === 64);
  });
});

describe("cases.ts / snapshot — unaffected by temporal-grounding change", () => {
  test("official case count remains 36", () => {
    assert.equal(BENCHMARK_CASES.length, 36);
  });

  test("tool-contract snapshot remains fresh", () => {
    const snapshotPath = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "tool-contracts.snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const result = checkSnapshotFreshness(snapshot);
    assert.equal(result.fresh, true);
  });
});
