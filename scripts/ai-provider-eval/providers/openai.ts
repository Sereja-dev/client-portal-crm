/**
 * Isolated Aqenra AI provider benchmark harness — OpenAI adapter.
 *
 * BENCHMARK ADAPTER ONLY — see providers/anthropic.ts's own header
 * comment for the exact same caveats (never reused as a real app
 * adapter, not typed `implements AiProvider` because production's
 * `AiRequest` has no `signal` field yet, never imports
 * provider-factory.ts/orchestrate.ts/request-context.ts/logging-policy.ts
 * or any app route/UI file).
 *
 * API SURFACE CHOICE: Chat Completions (`client.chat.completions.create`),
 * not the Responses API. Reasoning: orchestrate.ts's own loop is
 * stateless and rebuilds the FULL message history on every single call
 * (see that file's own `messages: [...messages]` — a fresh snapshot,
 * never a stored server-side thread) — this maps directly onto Chat
 * Completions' own stateless "pass the whole history every time" design.
 * The Responses API's own natural mode centers on a stored,
 * server-retained thread (`previous_response_id`), which would require
 * either fighting that model to stay stateless or introducing a second,
 * asymmetric conversation-state mechanism Anthropic's own adapter has no
 * equivalent for — a needless complication for a benchmark whose whole
 * point is symmetric treatment of both vendors (see README's own
 * "Fairness" section). Chat Completions' `role:"tool"` +
 * `tool_call_id` + assistant `tool_calls[]` also maps directly onto
 * AiMessage's role/content convention and orchestrate.ts's own
 * JSON-string-encoded tool-call/result convention, with no additional
 * translation machinery beyond what providers/anthropic.ts already needs
 * for its own native shape.
 */

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
import type { AiMessage, AiRequest, AiResponse, AiToolCall } from "../../../src/lib/ai/provider";
import { assertAllowedProviderHost } from "../network-allowlist.js";
import { getOpenAiEvalApiKey } from "../secrets.js";
import { OPENAI_MODEL_ID } from "../pricing.js";
import type { BenchmarkError, NormalizedProviderTurn } from "../result-types.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function buildClient(): OpenAI {
  // Same reasoning as providers/anthropic.ts's own buildClient(): the SDK
  // defaults `baseURL` from `process.env.OPENAI_BASE_URL` when unset, so
  // passing it explicitly here (after asserting it) is what actually
  // neutralizes that env var.
  assertAllowedProviderHost(OPENAI_BASE_URL);
  return new OpenAI({
    apiKey: getOpenAiEvalApiKey(),
    baseURL: OPENAI_BASE_URL,
    // Zero automatic SDK retries — see anthropic.ts's own identical
    // comment on why (benchmark-fairness, not a production
    // recommendation).
    maxRetries: 0,
  });
}

function toolCallIdFor(messageIndex: number): string {
  return `call_bench_${messageIndex}`;
}

function tryParseToolCallDescriptor(content: string): { toolName: string; args: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "toolName" in parsed &&
      typeof (parsed as { toolName: unknown }).toolName === "string"
    ) {
      return parsed as { toolName: string; args: unknown };
    }
  } catch {
    // Not JSON — an ordinary plain-text assistant message.
  }
  return null;
}

/** Same translation job as providers/anthropic.ts's own mapMessagesToAnthropic(), targeting Chat Completions' own tool_calls/tool-role shape instead. */
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
      // Not produced by orchestrate.ts's own loop (systemPrompt always
      // arrives via the dedicated leading system message above) — same
      // defensive handling as anthropic.ts's own equivalent branch.
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

function normalizeOpenAiError(err: unknown): BenchmarkError {
  if (err instanceof APIConnectionTimeoutError) return { kind: "timeout", message: "OpenAI request timed out." };
  if (err instanceof RateLimitError) return { kind: "rate_limited", message: "OpenAI rate limit exceeded." };
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return { kind: "invalid_request", message: "OpenAI authentication/permission error." };
  }
  if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) {
    return { kind: "invalid_request", message: "OpenAI rejected the request as malformed." };
  }
  if (err instanceof InternalServerError || err instanceof APIConnectionError) {
    return { kind: "unavailable", message: "OpenAI API unavailable." };
  }
  if (err instanceof APIError) return { kind: "unknown", message: `OpenAI API error (status ${err.status ?? "unknown"}).` };
  if (err instanceof Error && err.name === "AbortError") return { kind: "timeout", message: "OpenAI request aborted (local timeout)." };
  return { kind: "unknown", message: "Unrecognized OpenAI error." };
}

export async function completeWithOpenAi(request: AiRequest, options: { signal?: AbortSignal } = {}): Promise<NormalizedProviderTurn> {
  let client: OpenAI;
  try {
    client = buildClient();
  } catch (err) {
    return {
      kind: "error",
      error: err instanceof Error ? { kind: "invalid_request", message: err.message } : { kind: "unknown", message: "Failed to construct OpenAI client." },
    };
  }

  const tools: OpenAI.Chat.ChatCompletionTool[] = request.tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));

  try {
    const completion = await client.chat.completions.create(
      {
        model: OPENAI_MODEL_ID,
        max_completion_tokens: request.maxOutputTokens,
        messages: mapMessagesToOpenAi(request.systemPrompt, request.messages),
        tools,
        // At most one tool call per response — see README's own
        // "Single-call enforcement" section. Sampling params
        // deliberately omitted for both vendors — see README's own
        // "Sampling" section.
        parallel_tool_calls: false,
      },
      { signal: options.signal },
    );

    const choice = completion.choices[0];
    if (!choice) {
      return { kind: "error", error: { kind: "malformed_response", message: "OpenAI response contained no choices." } };
    }

    const toolCalls = choice.message.tool_calls ?? [];
    const functionToolCalls = toolCalls.filter((call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => call.type === "function");
    const rawToolCalls: AiToolCall[] = functionToolCalls.map((call) => ({
      toolName: call.function.name,
      args: parseFunctionArguments(call.function.arguments),
    }));

    if (functionToolCalls.length > 1) {
      return {
        kind: "protocol_violation",
        message: `OpenAI returned ${functionToolCalls.length} tool calls in one response despite parallel_tool_calls:false.`,
        rawToolCalls,
      };
    }

    const usage = {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      totalTokens: completion.usage?.total_tokens ?? 0,
    };

    if (functionToolCalls.length === 1) {
      const response: AiResponse = { kind: "toolCall", call: rawToolCalls[0], usage };
      return { kind: "ok", response };
    }

    if (choice.message.content === null || choice.message.content === undefined) {
      return { kind: "error", error: { kind: "malformed_response", message: "OpenAI response contained neither a tool call nor text content." } };
    }
    const response: AiResponse = { kind: "text", text: choice.message.content, usage };
    return { kind: "ok", response };
  } catch (err) {
    return { kind: "error", error: normalizeOpenAiError(err) };
  }
}

function parseFunctionArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // The vendor's own SDK type doc warns arguments may not always be
    // valid JSON (a model hallucination, not a transport error) — surface
    // it as the raw string rather than throwing, so the benchmark's own
    // argument-validity scoring (scoring.ts) can classify it as
    // "malformed" instead of the whole run crashing.
    return { __malformedArguments: raw };
  }
}
