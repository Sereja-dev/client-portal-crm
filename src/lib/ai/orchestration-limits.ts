/**
 * AI Assistant orchestration + Route Handler batch. Every fixed,
 * server-only ceiling the orchestration loop (orchestrate.ts) and the
 * request validator (request-schema.ts) enforce. Every value here is a
 * plain constant, never read from an env var, never derived from a
 * client request, and never influenced by anything a model's own tool
 * call/response could carry — matching this codebase's own existing
 * "fixed constant, not model/client-controlled" convention already used
 * for every tool's own SEARCH_*_LIMIT (tools/limits.ts).
 */

/** Request-schema.ts's own ceiling on the raw (pre-trim) `message` string length. */
export const MAX_USER_MESSAGE_CHARS = 2000;

/** Passed as AiRequest.maxOutputTokens on every provider.complete() call this orchestration makes. */
export const MAX_OUTPUT_TOKENS = 1024;

/** Hard ceiling on executed tool calls per orchestrated turn — see orchestrate.ts's own loop-limit doc comment for exactly what counts. */
export const MAX_TOOL_CALLS_PER_TURN = 5;

/** Hard ceiling on provider.complete() invocations per orchestrated turn: 1 initial + up to MAX_TOOL_CALLS_PER_TURN follow-ups. */
export const MAX_PROVIDER_CALLS_PER_TURN = 6;

/** Per-provider-call timeout, enforced via Promise.race in orchestrate.ts — not a change to AiRequest/AiProvider's own contract. */
export const PROVIDER_CALL_TIMEOUT_MS = 15_000;

/** Total wall-clock deadline for one orchestrated turn (covers every provider call and every tool execute() call combined). */
export const ORCHESTRATION_DEADLINE_MS = 45_000;

/** Maximum JSON.stringify()'d length of a single tool result before it is replaced with a generic "unavailable" result rather than reinjected as-is — see orchestrate.ts's own tool-result size guard. */
export const MAX_TOOL_RESULT_SERIALIZED_CHARS = 8_000;
