import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiRequest } from "../../../src/lib/ai/provider.js";
import { completeWithOpenAi } from "../providers/openai.js";
import { OPENAI_REASONING_EFFORT } from "../openai-compat.js";
import { OPENAI_MODEL_ID } from "../pricing.js";
import { BENCHMARK_TOOLS } from "../tool-runtime.js";
import { runBenchmarkTurn } from "../loop.js";

/**
 * Offline OpenAI benchmark-adapter tests — remediation of the 2026-09-03
 * live-run failure (results/OPERATIONAL-FAILURE-NOTE.md): gpt-5.6-luna
 * returned HTTP 400 on 108/108 requests because this adapter sent `tools`
 * on /v1/chat/completions without `reasoning_effort: "none"`.
 *
 * ZERO live calls. Every test installs a capturing `globalThis.fetch`
 * stub BEFORE `completeWithOpenAi` constructs its `OpenAI` client (the
 * SDK reads `globalThis.fetch` at construction time via
 * `Shims.getDefaultFetch()` — see node_modules/openai/internal/shims.js),
 * so the real request body is captured and the synthetic response is
 * fully local. No `api.openai.com` socket is ever opened. The stub never
 * reads or logs request headers, so the dummy Authorization key never
 * reaches output.
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const SIX_TOOL_SPECS = BENCHMARK_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

const DUMMY_KEY = "sk-eval-offline-DUMMY-0000000000000000";

let savedKey: string | undefined;
before(() => {
  savedKey = process.env.AQENRA_EVAL_OPENAI_API_KEY;
  process.env.AQENRA_EVAL_OPENAI_API_KEY = DUMMY_KEY;
});
after(() => {
  if (savedKey === undefined) delete process.env.AQENRA_EVAL_OPENAI_API_KEY;
  else process.env.AQENRA_EVAL_OPENAI_API_KEY = savedKey;
});

type CapturedRequest = { url: string; method: string; body: Record<string, unknown> };
type StubReply = { status: number; json: unknown };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Installs a capturing fetch stub. `reply(callIndex, body)` returns the synthetic HTTP reply for each call, newest call index first seen as 0. */
function installCapturingFetch(reply: (callIndex: number, body: Record<string, unknown>) => StubReply): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    const rawBody = init?.body;
    const bodyText = typeof rawBody === "string" ? rawBody : rawBody == null ? "" : String(rawBody);
    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
    calls.push({ url, method: init?.method ?? "GET", body });
    const { status, json } = reply(calls.length - 1, body);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls };
}

function chatCompletion(overrides: {
  content?: string | null;
  toolCalls?: { id?: string; name: string; arguments: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}): unknown {
  const toolCalls = (overrides.toolCalls ?? []).map((c, i) => ({
    id: c.id ?? `call_${i}`,
    type: "function",
    function: { name: c.name, arguments: c.arguments },
  }));
  return {
    id: "chatcmpl-offline",
    object: "chat.completion",
    created: 0,
    model: OPENAI_MODEL_ID,
    choices: [
      {
        index: 0,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: overrides.content ?? (toolCalls.length > 0 ? null : ""),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: overrides.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function baseRequest(partial: Partial<AiRequest> = {}): AiRequest {
  return {
    systemPrompt: "You are the Aqenra assistant.",
    messages: [{ role: "user", content: "How many active clients are there?" }],
    tools: SIX_TOOL_SPECS,
    maxOutputTokens: 1024,
    timeoutMs: 15_000,
    ...partial,
  };
}

describe("openai adapter — HTTP 400 regression (CRITICAL): the exact live-failure request shape is closed", () => {
  test("the generated Chat Completions request carries reasoning_effort:'none' whenever tools are present", async () => {
    const { calls } = installCapturingFetch(() => ({ status: 200, json: chatCompletion({ content: "6 active clients." }) }));

    await completeWithOpenAi(baseRequest());

    assert.equal(calls.length, 1);
    const body = calls[0].body;
    // The precise combination the vendor 400'd on before the fix:
    assert.equal(body.model, "gpt-5.6-luna");
    assert.ok(Array.isArray(body.tools) && (body.tools as unknown[]).length === 6, "all six tool schemas present");
    assert.equal(body.reasoning_effort, "none", "reasoning_effort MUST be the literal 'none' — this is the fix for the 108/108 400s");
    assert.equal(body.reasoning_effort, OPENAI_REASONING_EFFORT);
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.max_completion_tokens, 1024);
  });

  test("the request sends no streaming, no sampling params, and hits the /chat/completions endpoint", async () => {
    const { calls } = installCapturingFetch(() => ({ status: 200, json: chatCompletion({ content: "ok" }) }));
    await completeWithOpenAi(baseRequest());
    const { url, body } = calls[0];
    assert.match(url, /^https:\/\/api\.openai\.com\/v1\/chat\/completions/);
    assert.ok(!("stream" in body) || body.stream === false, "no streaming");
    assert.equal("temperature" in body, false, "no temperature — vendor-default sampling");
    assert.equal("top_p" in body, false, "no top_p — vendor-default sampling");
    assert.equal("top_k" in body, false);
    assert.equal("max_tokens" in body, false, "uses max_completion_tokens, not the deprecated max_tokens");
  });

  test("max_completion_tokens tracks AiRequest.maxOutputTokens exactly (nominal 1024 output ceiling preserved)", async () => {
    const { calls } = installCapturingFetch(() => ({ status: 200, json: chatCompletion({ content: "ok" }) }));
    await completeWithOpenAi(baseRequest({ maxOutputTokens: 777 }));
    assert.equal(calls[0].body.max_completion_tokens, 777);
  });

  test("adapter source pins the frozen compatibility parameters (defence-in-depth, not comment-only)", () => {
    const src = readFileSync(join(PACKAGE_DIR, "providers", "openai.ts"), "utf8");
    assert.match(src, /reasoning_effort:\s*OPENAI_REASONING_EFFORT/);
    assert.match(src, /parallel_tool_calls:\s*false/);
    assert.match(src, /max_completion_tokens:\s*request\.maxOutputTokens/);
    assert.match(src, /maxRetries:\s*0/);
    assert.equal(/stream:\s*true/.test(src), false);
    const compat = readFileSync(join(PACKAGE_DIR, "openai-compat.ts"), "utf8");
    assert.match(compat, /export const OPENAI_REASONING_EFFORT = "none"/);
  });
});

describe("openai adapter — single tool-call enforcement (parallel_tool_calls:false)", () => {
  test("exactly one tool call is normalized to an AiResponse toolCall, with parsed args", async () => {
    installCapturingFetch(() => ({
      status: 200,
      json: chatCompletion({ toolCalls: [{ name: "searchClients", arguments: JSON.stringify({ status: "active" }) }] }),
    }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "ok");
    if (turn.kind !== "ok") return;
    assert.equal(turn.response.kind, "toolCall");
    if (turn.response.kind !== "toolCall") return;
    assert.equal(turn.response.call.toolName, "searchClients");
    assert.deepEqual(turn.response.call.args, { status: "active" });
  });

  test("more than one returned tool call is a protocol_violation — never silently take the first, never retry", async () => {
    const { calls } = installCapturingFetch(() => ({
      status: 200,
      json: chatCompletion({
        toolCalls: [
          { name: "searchClients", arguments: "{}" },
          { name: "searchProjects", arguments: "{}" },
        ],
      }),
    }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "protocol_violation");
    if (turn.kind !== "protocol_violation") return;
    assert.equal(turn.rawToolCalls.length, 2, "both calls are surfaced for the trace, not discarded");
    assert.match(turn.message, /2 tool calls/);
    assert.equal(calls.length, 1, "no extra retry after a protocol violation");
  });
});

describe("openai adapter — message / tool-result continuation translation", () => {
  test("no-tool answer: a plain assistant message becomes an AiResponse text with mapped usage", async () => {
    installCapturingFetch(() => ({
      status: 200,
      json: chatCompletion({ content: "There are 6 active clients.", usage: { prompt_tokens: 412, completion_tokens: 33, total_tokens: 445 } }),
    }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "ok");
    if (turn.kind !== "ok" || turn.response.kind !== "text") return assert.fail("expected ok/text");
    assert.equal(turn.response.text, "There are 6 active clients.");
    assert.deepEqual(turn.response.usage, { promptTokens: 412, completionTokens: 33, totalTokens: 445 });
  });

  test("two-step chaining through the real loop: tool call -> tool result -> final text; the 2nd request re-sends history as assistant tool_calls + role:'tool'", async () => {
    const { calls } = installCapturingFetch((callIndex) => {
      if (callIndex === 0) {
        return {
          status: 200,
          json: chatCompletion({ toolCalls: [{ id: "call_abc", name: "searchClients", arguments: JSON.stringify({ status: "active" }) }], usage: { prompt_tokens: 400, completion_tokens: 12, total_tokens: 412 } }),
        };
      }
      return { status: 200, json: chatCompletion({ content: "There are 6 active clients.", usage: { prompt_tokens: 450, completion_tokens: 18, total_tokens: 468 } }) };
    });

    const result = await runBenchmarkTurn({
      provider: "openai",
      model: OPENAI_MODEL_ID,
      complete: completeWithOpenAi,
      userMessage: "How many active clients are there?",
      estimateCostUsd: () => 0,
    });

    assert.equal(result.finalText, "There are 6 active clients.");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolName, "searchClients");
    assert.equal(calls.length, 2);

    // Continuation shape on the follow-up request:
    const secondMessages = calls[1].body.messages as { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[];
    assert.equal(secondMessages[0].role, "system");
    assert.equal(secondMessages[1].role, "user");
    const assistantToolCall = secondMessages.find((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
    assert.ok(assistantToolCall, "assistant turn re-sent as tool_calls[]");
    const firstCall = (assistantToolCall!.tool_calls as { id: string; function: { name: string } }[])[0];
    const toolResult = secondMessages.find((m) => m.role === "tool");
    assert.ok(toolResult, "tool result re-sent as a role:'tool' message");
    assert.equal(toolResult!.tool_call_id, firstCall.id, "tool result references the matching tool_call id");

    // Every follow-up request still carries the frozen compatibility params:
    assert.equal(calls[1].body.reasoning_effort, "none");
    assert.equal(calls[1].body.parallel_tool_calls, false);
  });

  test("malformed tool-call arguments (invalid JSON) are surfaced, not thrown — scoring can classify them", async () => {
    installCapturingFetch(() => ({
      status: 200,
      json: chatCompletion({ toolCalls: [{ name: "searchClients", arguments: "{not valid json" }] }),
    }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "ok");
    if (turn.kind !== "ok" || turn.response.kind !== "toolCall") return assert.fail("expected ok/toolCall");
    assert.deepEqual(turn.response.call.args, { __malformedArguments: "{not valid json" });
  });

  test("a response with neither tool call nor content is a malformed_response error", async () => {
    installCapturingFetch(() => ({
      status: 200,
      json: {
        id: "x", object: "chat.completion", created: 0, model: OPENAI_MODEL_ID,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: null } }],
        usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
      },
    }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "error");
    if (turn.kind !== "error") return;
    assert.equal(turn.error.kind, "malformed_response");
  });
});

describe("openai adapter — usage mapping", () => {
  test("prompt/completion/total tokens map from snake_case; missing usage becomes zeros, never NaN", async () => {
    installCapturingFetch(() => ({
      status: 200,
      json: {
        id: "x", object: "chat.completion", created: 0, model: OPENAI_MODEL_ID,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }],
        // usage omitted entirely
      },
    }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "ok");
    if (turn.kind !== "ok" || turn.response.kind !== "text") return assert.fail("expected ok/text");
    assert.deepEqual(turn.response.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});

describe("openai adapter — error normalization (never leaks vendor text) + zero retry", () => {
  test("HTTP 400 invalid_request_error normalizes to { kind: 'invalid_request' } with a generic message", async () => {
    const { calls } = installCapturingFetch(() => ({
      status: 400,
      json: { error: { message: "Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions.", type: "invalid_request_error" } },
    }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "error");
    if (turn.kind !== "error") return;
    assert.equal(turn.error.kind, "invalid_request");
    assert.equal(turn.error.message, "OpenAI rejected the request as malformed.");
    assert.equal(turn.error.message.includes("reasoning_effort"), false, "vendor error text is never echoed through");
    assert.equal(calls.length, 1, "maxRetries:0 — a 400 is attempted exactly once");
  });

  test("HTTP 500 normalizes to { kind: 'unavailable' } and is NOT retried (maxRetries:0)", async () => {
    const { calls } = installCapturingFetch(() => ({ status: 500, json: { error: { message: "internal", type: "server_error" } } }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "error");
    if (turn.kind !== "error") return;
    assert.equal(turn.error.kind, "unavailable");
    assert.equal(calls.length, 1, "a retryable 5xx is still attempted exactly once — no automatic reasoning re-attempt the paired Anthropic run never gets");
  });

  test("HTTP 429 normalizes to { kind: 'rate_limited' } and is NOT retried", async () => {
    const { calls } = installCapturingFetch(() => ({ status: 429, json: { error: { message: "slow down", type: "rate_limit_error" } } }));
    const turn = await completeWithOpenAi(baseRequest());
    assert.equal(turn.kind, "error");
    if (turn.kind !== "error") return;
    assert.equal(turn.error.kind, "rate_limited");
    assert.equal(calls.length, 1);
  });
});

describe("openai adapter — tool schema parity (§9): all six logical schemas forwarded unmodified", () => {
  test("each forwarded tool is {type:'function', function:{name,description,parameters}} with the benchmark's own schema object", async () => {
    const { calls } = installCapturingFetch(() => ({ status: 200, json: chatCompletion({ content: "ok" }) }));
    await completeWithOpenAi(baseRequest());
    const tools = calls[0].body.tools as { type: string; function: { name: string; description: string; parameters: unknown } }[];
    assert.equal(tools.length, 6);
    const forwardedNames = tools.map((t) => t.function.name).sort();
    const expectedNames = SIX_TOOL_SPECS.map((t) => t.name).sort();
    assert.deepEqual(forwardedNames, expectedNames);
    for (const t of tools) {
      assert.equal(t.type, "function");
      const source = SIX_TOOL_SPECS.find((s) => s.name === t.function.name)!;
      assert.equal(t.function.description, source.description);
      assert.deepEqual(t.function.parameters, source.inputSchema, "schema forwarded verbatim — no simplification to make OpenAI pass");
    }
  });
});
