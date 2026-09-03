/**
 * Isolated Aqenra AI provider benchmark harness — Anthropic adapter.
 *
 * BENCHMARK ADAPTER ONLY — never imported by, or reused as, a real app
 * provider adapter (that is a separate, later, explicitly-deferred batch
 * — see the provider-selection research task's own §35). Normalizes
 * against the real, unmodified src/lib/ai/provider.ts types (AiRequest,
 * AiResponse, AiToolCall, AiProviderErrorKind) conceptually, the same way
 * a real adapter eventually would, but is intentionally NOT typed as
 * `implements AiProvider` — production's own `AiRequest` has no `signal`
 * field yet (a known, separate future hardening item; see README's own
 * "AbortSignal" note), so this adapter accepts it as a second, separate
 * parameter instead of proposing an app-code change here.
 *
 * Never imports provider-factory.ts, orchestrate.ts, request-context.ts,
 * logging-policy.ts, or any app route/UI file.
 */

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "@anthropic-ai/sdk";
import type { AiMessage, AiRequest, AiResponse, AiToolCall } from "../../../src/lib/ai/provider";
import { assertAllowedProviderHost } from "../network-allowlist.js";
import { getAnthropicEvalApiKey } from "../secrets.js";
import { ANTHROPIC_MODEL_ID } from "../pricing.js";
import type { BenchmarkError, NormalizedProviderTurn } from "../result-types.js";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

function buildClient(): Anthropic {
  // Asserted BEFORE the client is constructed, and passed explicitly —
  // the SDK itself defaults `baseURL` from `process.env.ANTHROPIC_BASE_URL`
  // when the caller doesn't pass one, so passing it explicitly here is
  // what actually neutralizes that env var, not merely documenting that
  // it shouldn't be set (see network-allowlist.ts's own doc comment).
  assertAllowedProviderHost(ANTHROPIC_BASE_URL);
  return new Anthropic({
    apiKey: getAnthropicEvalApiKey(),
    baseURL: ANTHROPIC_BASE_URL,
    // Zero automatic SDK retries — a retried call would silently give
    // this vendor an extra reasoning attempt the other provider's own
    // paired run never gets (see README's own "Retry fairness" section;
    // this is a benchmark-fairness requirement, not a production
    // recommendation).
    maxRetries: 0,
  });
}

function toolUseIdFor(messageIndex: number): string {
  return `toolu_bench_${messageIndex}`;
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
    // Not JSON — an ordinary plain-text assistant message (not currently
    // produced by orchestrate.ts's own loop, but handled below anyway).
  }
  return null;
}

/**
 * Mirrors orchestrate.ts's own exact message-construction convention
 * (see that file's own `messages.push({role:"assistant",
 * content:JSON.stringify({toolName,args})})` / `messages.push({role:
 * "tool", content:JSON.stringify(normalizedToolResult)})` pair) —
 * translating that generic, JSON-string-encoded convention into
 * Anthropic's own native `tool_use`/`tool_result` content-block shape.
 */
function mapMessagesToAnthropic(messages: AiMessage[]): Anthropic.MessageParam[] {
  const mapped: Anthropic.MessageParam[] = [];
  let pendingToolUseId: string | null = null;

  messages.forEach((message, index) => {
    if (message.role === "user") {
      mapped.push({ role: "user", content: message.content });
      return;
    }
    if (message.role === "assistant") {
      const parsed = tryParseToolCallDescriptor(message.content);
      if (parsed) {
        const id = toolUseIdFor(index);
        pendingToolUseId = id;
        mapped.push({ role: "assistant", content: [{ type: "tool_use", id, name: parsed.toolName, input: parsed.args }] });
        return;
      }
      mapped.push({ role: "assistant", content: message.content });
      return;
    }
    if (message.role === "system") {
      // Not produced by orchestrate.ts's own loop (systemPrompt is
      // always sent via the separate `system` field below) — handled
      // defensively rather than dropped silently, in case a future case
      // ever constructs one directly.
      mapped.push({ role: "user", content: `[system]\n${message.content}` });
      return;
    }
    // role === "tool" — always immediately preceded by the matching
    // assistant tool_use, per orchestrate.ts's own strict push/push
    // pairing (this loop only ever executes one tool call per turn).
    const id = pendingToolUseId ?? toolUseIdFor(index - 1);
    pendingToolUseId = null;
    mapped.push({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: message.content }] });
  });

  return mapped;
}

function normalizeAnthropicError(err: unknown): BenchmarkError {
  if (err instanceof APIConnectionTimeoutError) return { kind: "timeout", message: "Anthropic request timed out." };
  if (err instanceof RateLimitError) return { kind: "rate_limited", message: "Anthropic rate limit exceeded." };
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return { kind: "invalid_request", message: "Anthropic authentication/permission error." };
  }
  if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) {
    return { kind: "invalid_request", message: "Anthropic rejected the request as malformed." };
  }
  if (err instanceof InternalServerError || err instanceof APIConnectionError) {
    return { kind: "unavailable", message: "Anthropic API unavailable." };
  }
  if (err instanceof APIError) return { kind: "unknown", message: `Anthropic API error (status ${err.status ?? "unknown"}).` };
  if (err instanceof Error && err.name === "AbortError") return { kind: "timeout", message: "Anthropic request aborted (local timeout)." };
  return { kind: "unknown", message: "Unrecognized Anthropic error." };
}

export async function completeWithAnthropic(request: AiRequest, options: { signal?: AbortSignal } = {}): Promise<NormalizedProviderTurn> {
  let client: Anthropic;
  try {
    client = buildClient();
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? { kind: "invalid_request", message: err.message } : { kind: "unknown", message: "Failed to construct Anthropic client." } };
  }

  const tools: Anthropic.Tool[] = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));

  try {
    const message = await client.messages.create(
      {
        model: ANTHROPIC_MODEL_ID,
        max_tokens: request.maxOutputTokens,
        system: request.systemPrompt,
        messages: mapMessagesToAnthropic(request.messages),
        tools,
        // At most one tool call per response — see README's own
        // "Single-call enforcement" section. Sampling params
        // (temperature/top_p/top_k) are deliberately omitted for both
        // vendors — see README's own "Sampling" section.
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
      },
      { signal: options.signal },
    );

    const toolUseBlocks = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    const rawToolCalls: AiToolCall[] = toolUseBlocks.map((b) => ({ toolName: b.name, args: b.input }));

    if (toolUseBlocks.length > 1) {
      return {
        kind: "protocol_violation",
        message: `Anthropic returned ${toolUseBlocks.length} tool_use blocks in one response despite tool_choice.disable_parallel_tool_use:true.`,
        rawToolCalls,
      };
    }

    const usage = {
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      totalTokens: message.usage.input_tokens + message.usage.output_tokens,
    };

    if (toolUseBlocks.length === 1) {
      const response: AiResponse = { kind: "toolCall", call: rawToolCalls[0], usage };
      return { kind: "ok", response };
    }

    const textBlocks = message.content.filter((block): block is Anthropic.TextBlock => block.type === "text");
    if (textBlocks.length === 0) {
      return { kind: "error", error: { kind: "malformed_response", message: "Anthropic response contained neither a tool_use nor a text block." } };
    }
    const response: AiResponse = { kind: "text", text: textBlocks.map((b) => b.text).join(""), usage };
    return { kind: "ok", response };
  } catch (err) {
    return { kind: "error", error: normalizeAnthropicError(err) };
  }
}
