import { describe, expect, it, vi } from "vitest";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "openai";
import { createOpenAiProvider } from "@/lib/ai/providers/openai";
import { AiProviderError } from "@/lib/ai/provider";
import type { AiRequest } from "@/lib/ai/provider";

// src/lib/ai/providers/openai.ts imports the real "server-only" marker
// package — see test/unit/billing-paddle-provider.test.ts's own header
// comment for why this needs neutralizing here rather than disabling the
// guard globally.
vi.mock("server-only", () => ({}));

const API_KEY = "sk-test-fake-key-never-a-real-secret";

/**
 * No network, no real SDK instance — every test injects this in place of
 * a real OpenAI client via createOpenAiProvider's own DI parameter
 * (mirrors test/unit/billing-paddle-provider.test.ts's own
 * fakeSdkClient() pattern exactly). Never `vi.mock("openai")` — the real
 * error classes/types are exercised directly.
 */
function fakeClient(create: ReturnType<typeof vi.fn>): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const BASE_REQUEST: AiRequest = {
  systemPrompt: "You are the assistant.",
  messages: [{ role: "user", content: "How many clients do we have?" }],
  tools: [{ name: "searchClients", description: "Search clients.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
  maxOutputTokens: 512,
  timeoutMs: 15_000,
};

function chatCompletion(overrides: Partial<OpenAI.Chat.ChatCompletion["choices"][number]["message"]> & { usage?: Partial<NonNullable<OpenAI.Chat.ChatCompletion["usage"]>> } = {}) {
  const { usage, ...messageOverrides } = overrides;
  return {
    id: "chatcmpl_test",
    choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content: "The organization has 6 clients.", refusal: null, ...messageOverrides } }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, ...usage },
  } as unknown as OpenAI.Chat.ChatCompletion;
}

describe("createOpenAiProvider — identity", () => {
  it("reports providerId 'openai' and the exact configured modelId", () => {
    const provider = createOpenAiProvider(API_KEY, fakeClient(vi.fn()));
    expect(provider.providerId).toBe("openai");
    expect(provider.modelId).toBe("gpt-5.6-luna");
    expect(provider.stream).toBeUndefined();
  });
});

describe("createOpenAiProvider — request shape sent to the SDK", () => {
  it("sends the exact configured model/reasoning_effort/parallel_tool_calls, and maxOutputTokens as max_completion_tokens", async () => {
    const create = vi.fn().mockResolvedValue(chatCompletion());
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await provider.complete(BASE_REQUEST);

    expect(create).toHaveBeenCalledTimes(1);
    const [payload] = create.mock.calls[0]!;
    expect(payload.model).toBe("gpt-5.6-luna");
    expect(payload.reasoning_effort).toBe("none");
    expect(payload.parallel_tool_calls).toBe(false);
    expect(payload.max_completion_tokens).toBe(512);
  });

  it("maps tools into OpenAI's function-tool shape", async () => {
    const create = vi.fn().mockResolvedValue(chatCompletion());
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await provider.complete(BASE_REQUEST);

    const [payload] = create.mock.calls[0]!;
    expect(payload.tools).toEqual([
      { type: "function", function: { name: "searchClients", description: "Search clients.", parameters: BASE_REQUEST.tools[0]!.inputSchema } },
    ]);
  });

  it("never retries a failed call itself — the injected client's create() is invoked exactly once even on failure", async () => {
    const create = vi.fn().mockRejectedValue(new RateLimitError(429, {}, "rate limited", new Headers()));
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await provider.complete(BASE_REQUEST).catch(() => {});
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("createOpenAiProvider — response normalization", () => {
  it("normalizes a plain text response", async () => {
    const create = vi.fn().mockResolvedValue(chatCompletion({ content: "The organization has 6 clients." }));
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toEqual({
      kind: "text",
      text: "The organization has 6 clients.",
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    });
  });

  it("normalizes a single function-tool-call response into AiToolCall", async () => {
    const create = vi.fn().mockResolvedValue(
      chatCompletion({
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "searchClients", arguments: JSON.stringify({ query: "Acme" }) } }],
      }),
    );
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toEqual({
      kind: "toolCall",
      call: { toolName: "searchClients", args: { query: "Acme" } },
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    });
  });

  it("treats missing usage fields as 0, never undefined/NaN", async () => {
    const create = vi.fn().mockResolvedValue({ ...chatCompletion(), usage: undefined });
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toMatchObject({ usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
  });

  it("no raw SDK response object escapes complete()'s own return value — only the plain AiResponse shape", async () => {
    const create = vi.fn().mockResolvedValue(chatCompletion());
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    const result = await provider.complete(BASE_REQUEST);
    expect(Object.keys(result).sort()).toEqual(["kind", "text", "usage"].sort());
  });
});

describe("createOpenAiProvider — malformed/unknown tool-call handling", () => {
  it("a tool call with non-JSON arguments is surfaced as a safe marker object, never thrown/crashed", async () => {
    const create = vi.fn().mockResolvedValue(
      chatCompletion({ content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "searchClients", arguments: "{not valid json" } }] }),
    );
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toMatchObject({ kind: "toolCall", call: { toolName: "searchClients", args: { __malformedArguments: true } } });
  });

  it("more than one function tool call in one response is rejected as AiProviderError('unknown') — never silently taking the first", async () => {
    const create = vi.fn().mockResolvedValue(
      chatCompletion({
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "searchClients", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "searchProjects", arguments: "{}" } },
        ],
      }),
    );
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await expect(provider.complete(BASE_REQUEST)).rejects.toMatchObject({ name: "AiProviderError", kind: "unknown" });
  });

  it("neither text content nor a tool call in the response is rejected as AiProviderError('unknown')", async () => {
    const create = vi.fn().mockResolvedValue(chatCompletion({ content: null, tool_calls: undefined }));
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await expect(provider.complete(BASE_REQUEST)).rejects.toMatchObject({ name: "AiProviderError", kind: "unknown" });
  });

  it("a response with zero choices is rejected as AiProviderError('unknown')", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [], usage: undefined } as unknown as OpenAI.Chat.ChatCompletion);
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await expect(provider.complete(BASE_REQUEST)).rejects.toMatchObject({ name: "AiProviderError", kind: "unknown" });
  });

  it("an unknown/unregistered tool name from the model is still normalized through — tool-registry rejection is orchestrate.ts's own job, not the adapter's", async () => {
    const create = vi.fn().mockResolvedValue(
      chatCompletion({ content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "deleteEverything", arguments: "{}" } }] }),
    );
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    const result = await provider.complete(BASE_REQUEST);
    expect(result).toMatchObject({ kind: "toolCall", call: { toolName: "deleteEverything" } });
  });
});

describe("createOpenAiProvider — error normalization (no raw SDK error ever escapes)", () => {
  const HEADERS = new Headers();

  it.each([
    ["BadRequestError (400)", new BadRequestError(400, {}, "raw vendor message with a fake key sk-live-should-never-leak", HEADERS), "invalid_request"],
    ["UnprocessableEntityError (422)", new UnprocessableEntityError(422, {}, "raw vendor message", HEADERS), "invalid_request"],
    ["AuthenticationError (401)", new AuthenticationError(401, {}, "raw vendor message", HEADERS), "invalid_request"],
    ["PermissionDeniedError (403)", new PermissionDeniedError(403, {}, "raw vendor message", HEADERS), "invalid_request"],
    ["RateLimitError (429)", new RateLimitError(429, {}, "raw vendor message", HEADERS), "rate_limited"],
    ["InternalServerError (500)", new InternalServerError(500, {}, "raw vendor message", HEADERS), "unavailable"],
    ["APIConnectionError", new APIConnectionError({ message: "raw vendor message" }), "unavailable"],
    ["APIConnectionTimeoutError", new APIConnectionTimeoutError({ message: "raw vendor message" }), "timeout"],
    ["generic APIError (unmapped status)", new APIError(418, {}, "raw vendor message", HEADERS), "unknown"],
  ] as const)("%s normalizes to AiProviderError(%s)", async (_label, sdkError, expectedKind) => {
    const create = vi.fn().mockRejectedValue(sdkError);
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    const err = await provider.complete(BASE_REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).kind).toBe(expectedKind);
    // Never the raw vendor message, status, or headers.
    expect((err as AiProviderError).message).not.toContain("raw vendor message");
    expect(JSON.stringify(err)).not.toContain("sk-live-should-never-leak");
  });

  it("a plain AbortError (from an aborted signal) normalizes to AiProviderError('timeout')", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    const create = vi.fn().mockRejectedValue(abortError);
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await expect(provider.complete(BASE_REQUEST)).rejects.toMatchObject({ name: "AiProviderError", kind: "timeout" });
  });

  it("a completely unrecognized thrown value still normalizes safely to AiProviderError('unknown'), never crashing the caller", async () => {
    const create = vi.fn().mockRejectedValue("a plain string throw, not even an Error instance");
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await expect(provider.complete(BASE_REQUEST)).rejects.toMatchObject({ name: "AiProviderError", kind: "unknown" });
  });
});

describe("createOpenAiProvider — AbortSignal propagation", () => {
  it("forwards the caller's AbortSignal into the SDK's own request options (second argument)", async () => {
    const create = vi.fn().mockResolvedValue(chatCompletion());
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    const controller = new AbortController();

    await provider.complete(BASE_REQUEST, { signal: controller.signal });

    expect(create).toHaveBeenCalledTimes(1);
    const [, options] = create.mock.calls[0]!;
    expect(options).toEqual({ signal: controller.signal });
  });

  it("completes normally (signal: undefined) when the caller passes no options at all", async () => {
    const create = vi.fn().mockResolvedValue(chatCompletion());
    const provider = createOpenAiProvider(API_KEY, fakeClient(create));
    await provider.complete(BASE_REQUEST);
    const [, options] = create.mock.calls[0]!;
    expect(options).toEqual({ signal: undefined });
  });
});

describe("createOpenAiProvider — no secret leakage", () => {
  it("the API key never appears in any thrown error, or anywhere in a successful result", async () => {
    const secretKey = "sk-super-secret-should-never-leak-anywhere";
    const create = vi.fn().mockRejectedValue(new AuthenticationError(401, {}, `Incorrect API key provided: ${secretKey}`, new Headers()));
    const provider = createOpenAiProvider(secretKey, fakeClient(create));
    const err = await provider.complete(BASE_REQUEST).catch((e) => e);
    expect(JSON.stringify(err)).not.toContain(secretKey);
    expect(String((err as Error).message)).not.toContain(secretKey);
  });

  it("the constructed provider object itself never exposes the raw api key on any enumerable property", () => {
    const secretKey = "sk-super-secret-should-never-leak-anywhere";
    const provider = createOpenAiProvider(secretKey, fakeClient(vi.fn()));
    expect(JSON.stringify(provider)).not.toContain(secretKey);
  });
});
