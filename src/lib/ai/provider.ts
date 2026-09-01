/**
 * AI Assistant Batch 1A — the vendor-neutral core every provider adapter
 * (a future Batch 4, not this one) must implement, and the only shape
 * orchestration code (a future batch — no orchestrator exists yet) is
 * ever allowed to depend on. No vendor SDK type, name, or import appears
 * anywhere in this file, and none may be added to it later without also
 * moving this file's own guarantee to a per-vendor adapter instead — see
 * scripts/security-checks/check-ai-assistant-security.mjs's own "no
 * vendor SDK imports outside providers/**" rule.
 *
 * MVP orchestration is non-streaming (AiProvider.complete). `stream` is
 * declared now, optional, only because the shape costs nothing to reserve
 * and avoids a breaking interface change later — nothing in this batch
 * implements or calls it (see providers/mock.ts's own doc comment).
 */

/** One turn in a conversation, from the model's own point of view. A "tool" role message is this module's normalized representation of a tool's result being handed back to the model — never the tool's raw return value re-interpreted as a new instruction (see docs/ai-assistant plan's own prompt-injection threat model: retrieved data is always wrapped as data, never concatenated into anything resembling an instruction). */
export type AiMessageRole = "system" | "user" | "assistant" | "tool";

export type AiMessage = {
  role: AiMessageRole;
  content: string;
};

/**
 * The JSON-schema-shaped description of one callable tool, as presented
 * to the model — never the tool's own server-side implementation function
 * itself. `name` must be one of the closed allowlist entries in
 * src/lib/ai/tools/registry.ts; nothing in this file enforces that (this
 * is a pure data shape with zero dependency on the tools module), but no
 * orchestration code may construct an AiToolSpec from anything other than
 * that registry.
 */
export type AiToolSpec = {
  name: string;
  description: string;
  /** A JSON Schema object (draft shape left to the caller) describing the tool's input. Never `any`/unconstrained — every real tool's schema is a closed, narrow object (see the future data-tools batch). */
  inputSchema: Record<string, unknown>;
};

/** The model's normalized request to invoke one tool — provider-specific function-calling shapes are translated into this by each adapter, never leaked past it. */
export type AiToolCall = {
  toolName: string;
  /** Parsed, provider-agnostic arguments — still untrusted/unvalidated at this layer; the tool implementation itself is responsible for validating and rejecting malformed input (a future batch's own concern). */
  args: unknown;
};

/** What orchestration feeds back to the model after actually executing a requested tool call server-side — the model never executes anything itself. */
export type AiToolResult = {
  toolName: string;
  result: unknown;
};

/** Token accounting — provider-reported where available, deterministic/fixed for the mock provider (see providers/mock.ts). Feeds the metadata-only logging policy (src/lib/ai/logging-policy.ts); never used to reconstruct or infer prompt/response content. */
export type AiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * A normalized outcome — either the model produced a final text answer, or
 * it is requesting exactly one tool call. There is no "both at once" shape
 * on purpose: orchestration (a future batch) always executes at most one
 * tool call per model turn, then re-prompts with the result, matching the
 * bounded "max tool calls per turn" cost control the architecture plan
 * requires.
 */
export type AiResponse =
  | { kind: "text"; text: string; usage: AiUsage }
  | { kind: "toolCall"; call: AiToolCall; usage: AiUsage };

/**
 * Every failure a provider adapter can surface is normalized into one of
 * these — never the vendor's own raw error object, message, or stack
 * (which could carry request content, an API key fragment in a URL, or a
 * vendor-specific detail this app has no business logging or displaying).
 * `kind: "unknown"` is the deliberate catch-all for "a real error occurred
 * and none of the specific categories apply" — still just a category, no
 * message field carrying provider-supplied text.
 */
export type AiProviderErrorKind = "timeout" | "rate_limited" | "unavailable" | "invalid_request" | "unknown";

export class AiProviderError extends Error {
  readonly kind: AiProviderErrorKind;

  constructor(kind: AiProviderErrorKind) {
    super(`AI provider error: ${kind}`);
    this.name = "AiProviderError";
    this.kind = kind;
  }
}

export type AiRequest = {
  /** Server-authored only — see src/lib/ai/system-prompt.ts (a future batch). Never interpolates retrieved business content; tool results travel exclusively as "tool"-role AiMessage entries instead. */
  systemPrompt: string;
  messages: AiMessage[];
  /** The closed allowlist for this turn — empty in Batch 1A, since no business-data tool exists yet (see tools/registry.ts). */
  tools: AiToolSpec[];
  maxOutputTokens: number;
  timeoutMs: number;
};

/**
 * The one interface every provider adapter implements, and the only
 * dependency orchestration code is allowed to take. `complete` is the
 * MVP, non-streaming call every batch through UI (Batch 3) uses; `stream`
 * is reserved for a later stage and intentionally unimplemented by the
 * mock provider (throws if ever called — see providers/mock.ts).
 */
export interface AiProvider {
  complete(request: AiRequest): Promise<AiResponse>;
  stream?(request: AiRequest): AsyncIterable<AiResponse>;
}
