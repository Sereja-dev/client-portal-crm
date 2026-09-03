import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runBenchmarkTurn, type ProviderCompleteFn } from "../loop.js";
import type { NormalizedProviderTurn } from "../result-types.js";

const ZERO_COST = () => 0;
const USAGE = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

function scripted(turns: NormalizedProviderTurn[]): ProviderCompleteFn {
  let cursor = 0;
  return async () => {
    if (cursor >= turns.length) throw new Error("scripted provider: ran out of turns");
    const turn = turns[cursor];
    cursor += 1;
    return turn;
  };
}

describe("loop.ts — benchmark-only minimal orchestration loop", () => {
  test("terminates immediately on a first-turn text response", async () => {
    const complete = scripted([{ kind: "ok", response: { kind: "text", text: "Hello.", usage: USAGE } }]);
    const result = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: "hi", estimateCostUsd: ZERO_COST });
    assert.equal(result.finalText, "Hello.");
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.protocolViolation, false);
  });

  test("executes a real fixture tool call and feeds the result back for a second turn", async () => {
    const complete = scripted([
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: {} }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: "There are 6 clients.", usage: USAGE } },
    ]);
    const result = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: "how many clients?", estimateCostUsd: ZERO_COST });
    assert.equal(result.finalText, "There are 6 clients.");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolName, "searchClients");
    assert.equal(result.toolCalls[0].resultOk, true);
  });

  test("records an unregistered tool name as a failed trace, without crashing, and continues the loop", async () => {
    const complete = scripted([
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "deleteEverything", args: {} }, usage: USAGE } },
      { kind: "ok", response: { kind: "text", text: "I can't do that.", usage: USAGE } },
    ]);
    const result = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: "delete stuff", estimateCostUsd: ZERO_COST });
    assert.equal(result.toolCalls[0].isRegisteredTool, false);
    assert.equal(result.toolCalls[0].resultOk, false);
    assert.equal(result.finalText, "I can't do that.");
  });

  test("a protocol_violation turn (vendor returned >1 tool call) hard-fails immediately — never silently takes the first call", async () => {
    const complete = scripted([{ kind: "protocol_violation", message: "returned 2 tool calls", rawToolCalls: [{ toolName: "searchClients", args: {} }, { toolName: "searchProjects", args: {} }] }]);
    const result = await runBenchmarkTurn({ provider: "openai", model: "m", complete, userMessage: "x", estimateCostUsd: ZERO_COST });
    assert.equal(result.protocolViolation, true);
    assert.equal(result.finalText, null);
    assert.equal(result.toolCalls.length, 0, "no tool call is executed on a protocol violation");
  });

  test("hard-fails as a protocol violation once MAX_TOOL_CALLS_PER_TURN (5) is exceeded", async () => {
    const toolCallTurn: NormalizedProviderTurn = { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: {} }, usage: USAGE } };
    // 6 consecutive tool-call turns — the 6th tool call attempt (after 5 already executed) must be refused.
    const complete = scripted(Array.from({ length: 7 }, () => toolCallTurn));
    const result = await runBenchmarkTurn({ provider: "anthropic", model: "m", complete, userMessage: "x", estimateCostUsd: ZERO_COST });
    assert.equal(result.protocolViolation, false); // ceiling breach uses errorClass, not the protocolViolation flag from a vendor-side violation
    assert.equal(result.errorClass, "protocol_violation");
    assert.ok(result.toolCalls.length <= 5);
  });

  test("a provider error (e.g. rate_limited) terminates the run with that error class", async () => {
    const complete = scripted([{ kind: "error", error: { kind: "rate_limited", message: "429" } }]);
    const result = await runBenchmarkTurn({ provider: "openai", model: "m", complete, userMessage: "x", estimateCostUsd: ZERO_COST });
    assert.equal(result.errorClass, "rate_limited");
    assert.equal(result.finalText, null);
  });

  test("aggregates usage and cost across every provider call in the run", async () => {
    const complete = scripted([
      { kind: "ok", response: { kind: "toolCall", call: { toolName: "searchClients", args: {} }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } } },
      { kind: "ok", response: { kind: "text", text: "done", usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 } } },
    ]);
    const result = await runBenchmarkTurn({
      provider: "anthropic",
      model: "m",
      complete,
      userMessage: "x",
      estimateCostUsd: (p, c) => p * 0.001 + c * 0.002,
    });
    assert.equal(result.totalUsage.promptTokens, 30);
    assert.equal(result.totalUsage.completionTokens, 13);
    assert.equal(result.totalUsage.totalTokens, 43);
    assert.ok(result.estimatedCostUsd > 0);
  });
});
