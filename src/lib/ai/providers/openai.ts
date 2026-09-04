import "server-only";
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
import type { AiCompleteOptions, AiMessage, AiProvider, AiRequest, AiResponse, AiToolCall } from "../provider";
import { AiProviderError } from "../provider";

/**
 * AI Assistant — the real OpenAI provider adapter. The ONLY file in this
 * application allowed to import the `openai` SDK (see
 * scripts/security-checks/check-ai-assistant-security.mjs's own scoped
 * vendor-SDK rule) — every other file under src/lib/ai/** and
 * src/app/api/ai/** only ever depends on provider.ts's own vendor-neutral
 * `AiProvider` shape, never this module or the `openai` package directly.
 *
 * Constructed only by provider-factory.ts, only when
 * getOpenAiProviderConfig() (./openai-config.ts) resolves to
 * `{ status: "configured" }` — this file itself never reads
 * `process.env`, never decides whether it should run.
 *
 * Model/request shape mirrors the already-reviewed, offline-validated
 * eval-harness adapter at scripts/ai-provider-eval/providers/openai.ts
 * (an isolated, unrelated package — never imported from here, and this
 * file is never imported from there): same target model, same
 * `reasoning_effort`/`parallel_tool_calls`/`maxRetries` compatibility
 * settings, same Chat Completions API surface, same stateless
 * "resend the full message history every call" shape that matches
 * orchestrate.ts's own loop exactly. Re-implemented independently here
 * (not shared code) because the eval harness and this adapter target
 * deliberately different, non-overlapping type contracts — see this
 * file's own AiProvider implementation vs. that file's own
 * NormalizedProviderTurn-returning ProviderCompleteFn shape.
 *
 * No streaming: `stream` is left undefined, matching every other adapter
 * in this batch (see provider.ts's own doc comment — MVP orchestration is
 * non-streaming only).
 *
 * Every vendor SDK object (the client, the completion response, any SDK
 * error instance) is fully consumed and normalized to a plain
 * AiResponse/AiProviderError INSIDE this file — nothing vendor-shaped
 * ever escapes complete()'s own return value or thrown error.
 */

const OPENAI_MODEL_ID = "gpt-5.6-luna";

/**
 * `gpt-5.6-luna` is a reasoning model that rejects `tools` on
 * `/v1/chat/completions` with an HTTP 400 unless `reasoning_effort` is
 * explicitly `"none"` — see the eval harness's own openai.ts header
 * comment for the full vendor-message citation and the exact 2026-09-03
 * operational-failure history this setting exists to avoid repeating.
 * Not a sampling parameter (temperature/top_p/top_k remain
 * vendor-default, unset by this adapter either way).
 */
const OPENAI_REASONING_EFFORT = "none" satisfies OpenAI.Chat.ChatCompletionReasoningEffort;

/**
 * The SDK reads `process.env.OPENAI_BASE_URL` internally when `baseURL`
 * is left unset — always passing this literal explicitly (never derived
 * from any env var this app reads) neutralizes that fallback, so a stray
 * `OPENAI_BASE_URL` set anywhere in the environment can never silently
 * redirect a real request elsewhere.
 */
const OPENAI_BASE_URL = "https://api.openai.com/v1";

function buildClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENAI_BASE_URL,
    // Zero automatic SDK retries — orchestrate.ts's own loop is the only
    // place a "try again" decision is ever allowed to happen (it doesn't
    // retry either — see this batch's own "no retry loop" requirement),
    // never silently duplicated inside the transport layer underneath it.
    maxRetries: 0,
  });
}

function toolCallIdFor(messageIndex: number): string {
  return `call_${messageIndex}`;
}

function tryParseToolCallDescriptor(content: string): { toolName: string; args: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null && "toolName" in parsed && typeof (parsed as { toolName: unknown }).toolName === "string") {
      return parsed as { toolName: string; args: unknown };
    }
  } catch {
    // Not JSON — an ordinary plain-text assistant message.
  }
  return null;
}

/**
 * Translates orchestrate.ts's own role/content convention (see that
 * file's own `messages.push({role:"assistant", content: JSON.stringify(...)})`
 * / `messages.push({role:"tool", content: ...})` calls) into Chat
 * Completions' native `tool_calls[]` / `tool_call_id` shape. Purely a
 * shape translation over already-normalized AiMessage entries — never
 * reads or infers anything beyond what orchestrate.ts already put there.
 */
function mapMessagesToOpenAi(systemPrompt: string, messages: AiMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const mapped: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];
  let pendingToolCallId: string | null = null;

  messages.forEach((message, index) => {
    if (message.role === "user") {
      mapped.push({ role: "user", content: message.content });
      return;
    }
    if (message.role === "assistant") {
      const parsed = tryParseToolCallDescriptor(message.content);
      if (parsed) {
        const id = toolCallIdFor(index);
        pendingToolCallId = id;
        mapped.push({
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name: parsed.toolName, arguments: JSON.stringify(parsed.args ?? {}) } }],
        });
        return;
      }
      mapped.push({ role: "assistant", content: message.content });
      return;
    }
    if (message.role === "system") {
      // Not produced by orchestrate.ts's own loop today (systemPrompt
      // always arrives via the dedicated leading system message above) —
      // defensive handling only, matching the eval harness's own adapter.
      mapped.push({ role: "user", content: `[system]\n${message.content}` });
      return;
    }
    // role === "tool"
    const id = pendingToolCallId ?? toolCallIdFor(index - 1);
    pendingToolCallId = null;
    mapped.push({ role: "tool", tool_call_id: id, content: message.content });
  });

  return mapped;
}

function parseFunctionArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // The vendor SDK's own type doc warns arguments may not always be
    // valid JSON (a model hallucination, not a transport error) — surface
    // it as a plain marker object rather than throwing, so a downstream
    // tool's own schema validator rejects it as invalid_input instead of
    // this whole turn crashing.
    return { __malformedArguments: true };
  }
}

/**
 * Normalizes every vendor SDK error into production's own closed
 * 5-value AiProviderErrorKind (provider.ts) — never a 6th category, and
 * never the raw error's own message/stack/headers/request id (see this
 * batch's own "no raw SDK error... to UI/logs" requirement).
 */
function normalizeOpenAiError(err: unknown): AiProviderError {
  if (err instanceof Error && err.name === "AbortError") return new AiProviderError("timeout");
  if (err instanceof APIConnectionTimeoutError) return new AiProviderError("timeout");
  if (err instanceof RateLimitError) return new AiProviderError("rate_limited");
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) return new AiProviderError("invalid_request");
  if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) return new AiProviderError("invalid_request");
  if (err instanceof InternalServerError || err instanceof APIConnectionError) return new AiProviderError("unavailable");
  if (err instanceof APIError) return new AiProviderError("unknown");
  return new AiProviderError("unknown");
}

/**
 * `client` is dependency-injected — mirrors
 * src/lib/billing/provider/paddle-provider.ts's own
 * `createPaddleBillingProvider(config, sdkClient = createPaddleSdkClient(config))`
 * shape exactly. Production call sites (provider-factory.ts) never pass a
 * second argument, so they always get the real SDK client built from
 * `apiKey`; tests inject a fake client shaped like
 * `{ chat: { completions: { create: vi.fn() } } }` — never a `vi.mock("openai")`
 * module mock — so this adapter's own normalization/mapping logic is
 * exercised against a real function call, with zero chance of a live
 * request ever being attempted from a test.
 */
export function createOpenAiProvider(apiKey: string, client: OpenAI = buildClient(apiKey)): AiProvider {
  return {
    providerId: "openai",
    modelId: OPENAI_MODEL_ID,
    stream: undefined,

    async complete(request: AiRequest, options?: AiCompleteOptions): Promise<AiResponse> {
      const tools: OpenAI.Chat.ChatCompletionTool[] = request.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      }));

      let completion: OpenAI.Chat.ChatCompletion;
      try {
        completion = await client.chat.completions.create(
          {
            model: OPENAI_MODEL_ID,
            max_completion_tokens: request.maxOutputTokens,
            messages: mapMessagesToOpenAi(request.systemPrompt, request.messages),
            tools,
            // Required for gpt-5.6-luna to accept `tools` at all — see
            // this file's own header comment.
            reasoning_effort: OPENAI_REASONING_EFFORT,
            // At most one tool call per response — orchestrate.ts's own
            // loop only ever executes one tool call per model turn.
            parallel_tool_calls: false,
          },
          { signal: options?.signal },
        );
      } catch (err) {
        throw normalizeOpenAiError(err);
      }

      const choice = completion.choices[0];
      if (!choice) {
        throw new AiProviderError("unknown");
      }

      const usage = {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
      };

      const toolCalls = choice.message.tool_calls ?? [];
      const functionToolCalls = toolCalls.filter(
        (call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => call.type === "function",
      );

      if (functionToolCalls.length > 1) {
        // The vendor returned more than one tool call despite
        // parallel_tool_calls:false — a genuine protocol anomaly, not any
        // of the five closed error categories; "unknown" is the
        // documented catch-all for exactly this (see provider.ts's own
        // doc comment). orchestrate.ts's own loop only ever executes at
        // most one tool call per turn regardless, so silently taking the
        // first and discarding the rest would misrepresent what the
        // vendor actually returned.
        throw new AiProviderError("unknown");
      }

      if (functionToolCalls.length === 1) {
        const call: AiToolCall = {
          toolName: functionToolCalls[0].function.name,
          args: parseFunctionArguments(functionToolCalls[0].function.arguments),
        };
        return { kind: "toolCall", call, usage };
      }

      if (typeof choice.message.content !== "string") {
        // Neither a tool call nor text content — a malformed response
        // shape, not any of the five closed error categories.
        throw new AiProviderError("unknown");
      }

      return { kind: "text", text: choice.message.content, usage };
    },
  };
}
