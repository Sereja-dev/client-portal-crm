import "server-only";
import type { AiMessage, AiProvider, AiProviderErrorKind, AiRequest, AiResponse, AiToolCall, AiUsage } from "./provider";
import type { AiToolResult as ProviderAiToolResult } from "./provider";
import { AiProviderError } from "./provider";
import { getAiToolByName, getRegisteredAiTools } from "./tools/registry";
import { getAiAssistantSystemPrompt } from "./system-prompt";
import { generateAiRequestCorrelationId, logAiAssistantEvent } from "./logging-policy";
import {
  MAX_OUTPUT_TOKENS,
  MAX_PROVIDER_CALLS_PER_TURN,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TOOL_RESULT_SERIALIZED_CHARS,
  ORCHESTRATION_DEADLINE_MS,
  PROVIDER_CALL_TIMEOUT_MS,
} from "./orchestration-limits";

/**
 * AI Assistant orchestration + Route Handler batch. The one server-only
 * entry point that turns a single, already-validated user message into a
 * final answer — the only thing the Route Handler (route.ts) ever calls
 * to actually talk to a provider.
 *
 * Owns: the fixed system prompt, the initial user message, every
 * provider.complete() call, tool dispatch and result reinjection, the
 * hard tool-call/provider-call ceilings, per-call timeout and the total
 * turn deadline, usage aggregation, final-answer validation (empty-answer
 * and raw-identifier guards), the one metadata-only log event for this
 * turn, and the normalized AiOrchestrationResult this function returns.
 *
 * Deliberately does NOT: authenticate anyone, resolve an organization or
 * session (organizationId arrives as a plain parameter, exactly like
 * every AiToolDefinition.execute()'s own first argument — never
 * re-derived from anything here), mutate the database (it only ever
 * calls a registered tool's own already-read-only execute()), call any
 * Server Action, import any vendor SDK (it only ever holds the AiProvider
 * reference its caller passes in), or persist any conversation state
 * (nothing here writes to Prisma or any store — a fresh in-memory
 * `messages` array exists only for the lifetime of one call).
 */

export type AiOrchestrationErrorKind =
  | "limit_exceeded"
  | "timeout"
  | "provider_error"
  | "invalid_response"
  | "empty_answer"
  | "ref_leak";

export type AiOrchestrationResult = { ok: true; answer: string } | { ok: false; kind: AiOrchestrationErrorKind };

/**
 * The exact repository UUID convention (tools/validation.ts's own
 * UUID_PATTERN), used here unanchored so it can be tested against any
 * position inside a larger answer string rather than the whole string —
 * the same character-class definition, not a broader/looser heuristic.
 */
const RAW_UUID_SCAN_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function containsRawUuid(text: string): boolean {
  return RAW_UUID_SCAN_PATTERN.test(text);
}

function isValidUsageShape(value: unknown): value is AiUsage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys: (keyof AiUsage)[] = ["promptTokens", "completionTokens", "totalTokens"];
  return keys.every((key) => {
    const count = record[key];
    return typeof count === "number" && Number.isFinite(count) && count >= 0;
  });
}

function isValidToolCallShape(value: unknown): value is AiToolCall {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.toolName === "string" && record.toolName.length > 0;
}

/**
 * Runtime narrowing of whatever a provider adapter actually resolved
 * with — never trusts AiResponse's own compile-time type alone (the same
 * "defense-in-depth against a caller that bypasses the type system"
 * discipline logging-policy.ts's own isValidUsage() already established).
 * Only exactly `kind: "text"` and `kind: "toolCall"`, each with a valid
 * `usage`, are accepted; anything else (an unrecognized kind, a missing/
 * malformed `text`/`call`, a non-object value) is rejected.
 */
function isValidAiResponse(value: unknown): value is AiResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "text") {
    return typeof record.text === "string" && isValidUsageShape(record.usage);
  }
  if (record.kind === "toolCall") {
    return isValidToolCallShape(record.call) && isValidUsageShape(record.usage);
  }
  return false;
}

class OrchestrationCallTimeoutError extends Error {
  constructor() {
    super("AI provider call timed out.");
    this.name = "OrchestrationCallTimeoutError";
  }
}

/**
 * Enforces `timeoutMs` at the orchestration level via Promise.race — this
 * is the mechanism that GUARANTEES a turn returns on time regardless of
 * provider cooperation, unchanged from before real cancellation existed.
 * Layered on top of that (new): a real `AbortController` is constructed
 * per call and its `signal` is handed to `provider.complete()`; the same
 * timer that wins the race also calls `controller.abort()` first, so a
 * cooperative adapter (providers/openai.ts) genuinely cancels its
 * underlying HTTP request the moment the deadline fires, rather than the
 * orchestrator merely giving up on a response while the real outbound
 * request keeps running unseen. An adapter that ignores the signal (the
 * mock, a hand-built test stub) is unaffected — Promise.race still wins
 * the race for it exactly as before this abort mechanism existed. Never
 * a retry: the caller of this function receives exactly one settled
 * outcome (a response or OrchestrationCallTimeoutError) per invocation.
 */
async function callProviderWithTimeout(provider: AiProvider, request: AiRequest, timeoutMs: number): Promise<AiResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OrchestrationCallTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([provider.complete(request, { signal: controller.signal }), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolves one model-requested tool call against the closed registry
 * ONLY (getAiToolByName — never a dynamic import/eval/property lookup by
 * any other means). organizationId is the orchestrator's own
 * already-authorized value, injected as execute()'s first argument —
 * never anything derived from `call.args`, which is passed through
 * exactly as the provider supplied it (still untrusted at this layer;
 * the tool's own validator is what actually rejects malformed args).
 *
 * Every tool's own execute() already resolves (never throws) for an
 * ordinary domain outcome (see tools/result.ts's own doc comment) — the
 * try/catch here is a defensive backstop against a tool throwing
 * anyway, not the expected path.
 *
 * Reinjection payload is exactly the tool's own already-privacy-safe
 * AiToolResult<T>, JSON-stringified — never a raw exception, never any
 * field beyond what the tool itself already returns.
 */
async function dispatchToolCall(organizationId: string, call: AiToolCall): Promise<ProviderAiToolResult> {
  const tool = getAiToolByName(call.toolName);
  if (!tool) {
    return { toolName: call.toolName, result: { ok: false, error: "invalid_input" } };
  }

  let toolResult: unknown;
  try {
    toolResult = await tool.execute(organizationId, call.args);
  } catch {
    toolResult = { ok: false, error: "unavailable" };
  }

  const serialized = JSON.stringify(toolResult);
  if (serialized.length > MAX_TOOL_RESULT_SERIALIZED_CHARS) {
    // Never truncate mid-object (risks invalid JSON or a silently
    // altered value) and never log the oversized content itself — swap
    // in the same generic "unavailable" shape a genuine tool failure
    // already produces.
    return { toolName: call.toolName, result: { ok: false, error: "unavailable" } };
  }

  return { toolName: call.toolName, result: toolResult };
}

function toErrorKindForLog(kind: AiOrchestrationErrorKind, providerErrorKind: AiProviderErrorKind | undefined): AiProviderErrorKind | undefined {
  if (kind === "timeout") return "timeout";
  if (kind === "provider_error") return providerErrorKind ?? "unknown";
  if (kind === "invalid_response" || kind === "empty_answer" || kind === "ref_leak") return "unknown";
  // "limit_exceeded" has no matching AiProviderErrorKind category — omit
  // errorKind for it rather than force a misleading value.
  return undefined;
}

export async function runAiAssistantTurn(input: {
  organizationId: string;
  provider: AiProvider;
  userMessage: string;
}): Promise<AiOrchestrationResult> {
  const { organizationId, provider, userMessage } = input;

  const correlationId = generateAiRequestCorrelationId();
  const startedAt = Date.now();
  const usage: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let lastToolName: string | undefined;
  let providerCallCount = 0;
  let toolCallCount = 0;

  function finish(result: AiOrchestrationResult, providerErrorKind?: AiProviderErrorKind): AiOrchestrationResult {
    const latencyMs = Date.now() - startedAt;
    const errorKind = result.ok ? undefined : toErrorKindForLog(result.kind, providerErrorKind);
    logAiAssistantEvent({
      timestamp: new Date().toISOString(),
      provider: provider.providerId ?? "unknown",
      model: provider.modelId ?? "unknown",
      latencyMs,
      usage,
      providerCallCount,
      toolCallCount,
      ...(lastToolName ? { toolName: lastToolName } : {}),
      category: result.ok ? "success" : "error",
      ...(errorKind ? { errorKind } : {}),
      correlationId,
    });
    return result;
  }

  const toolSpecs = getRegisteredAiTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  const messages: AiMessage[] = [{ role: "user", content: userMessage }];

  while (true) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > ORCHESTRATION_DEADLINE_MS) {
      return finish({ ok: false, kind: "timeout" });
    }
    // Defense-in-depth only — the tool-call-ceiling check below already
    // guarantees a 7th provider call is never attempted; this should be
    // structurally unreachable.
    if (providerCallCount >= MAX_PROVIDER_CALLS_PER_TURN) {
      return finish({ ok: false, kind: "limit_exceeded" });
    }

    // The EFFECTIVE per-call budget is whichever is smaller: the fixed
    // per-call ceiling, or however much of the total-turn deadline
    // remains. Without this, a call starting late in a multi-tool-call
    // turn could still run for a full PROVIDER_CALL_TIMEOUT_MS even
    // though the turn's own ORCHESTRATION_DEADLINE_MS is about to (or
    // already did) elapse — this is what makes the total-turn deadline
    // actually CANCEL an in-flight request (via callProviderWithTimeout's
    // own AbortController), not just get checked between calls.
    const remainingBudgetMs = ORCHESTRATION_DEADLINE_MS - elapsedMs;
    const effectiveCallTimeoutMs = Math.min(PROVIDER_CALL_TIMEOUT_MS, remainingBudgetMs);

    const request: AiRequest = {
      systemPrompt: getAiAssistantSystemPrompt(),
      // A fresh snapshot on every call — messages is mutated in place as
      // the loop progresses (each tool call appends two entries), and a
      // provider is free to retain the AiRequest it was given for
      // asynchronous use; it must never observe a later mutation of an
      // array it was already handed.
      messages: [...messages],
      tools: toolSpecs,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: effectiveCallTimeoutMs,
    };

    let response: AiResponse;
    try {
      response = await callProviderWithTimeout(provider, request, effectiveCallTimeoutMs);
      providerCallCount += 1;
    } catch (err) {
      providerCallCount += 1;
      if (err instanceof OrchestrationCallTimeoutError) {
        return finish({ ok: false, kind: "timeout" });
      }
      const providerErrorKind = err instanceof AiProviderError ? err.kind : "unknown";
      return finish({ ok: false, kind: "provider_error" }, providerErrorKind);
    }

    if (!isValidAiResponse(response)) {
      return finish({ ok: false, kind: "invalid_response" });
    }

    usage.promptTokens += response.usage.promptTokens;
    usage.completionTokens += response.usage.completionTokens;
    usage.totalTokens += response.usage.totalTokens;

    if (response.kind === "text") {
      const answer = response.text.trim();
      if (answer.length === 0) {
        return finish({ ok: false, kind: "empty_answer" });
      }
      if (containsRawUuid(answer)) {
        // Never redact in place — discard the whole answer rather than
        // return a partially-mangled one.
        return finish({ ok: false, kind: "ref_leak" });
      }
      return finish({ ok: true, answer });
    }

    // kind === "toolCall"
    toolCallCount += 1;
    if (toolCallCount > MAX_TOOL_CALLS_PER_TURN) {
      // Do NOT execute the tool, do NOT call the provider again.
      return finish({ ok: false, kind: "limit_exceeded" });
    }

    const call = response.call;
    lastToolName = call.toolName;

    // Assistant/provider progression kept structurally separate from
    // both the system prompt and the tool's own result — this message's
    // content is only the model's own prior request, never business data.
    messages.push({ role: "assistant", content: JSON.stringify({ toolName: call.toolName, args: call.args }) });

    const normalizedToolResult = await dispatchToolCall(organizationId, call);
    messages.push({ role: "tool", content: JSON.stringify(normalizedToolResult) });
  }
}
