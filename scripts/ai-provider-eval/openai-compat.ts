/**
 * Isolated Aqenra AI provider benchmark harness — OpenAI request-shape
 * compatibility constant.
 *
 * SDK-FREE ON PURPOSE. This module imports nothing (no `openai` SDK, no
 * app code) so it can be pulled into report.ts (and its reproducibility
 * metadata) without dragging the vendor SDK onto index.ts's own
 * top-level import graph — the "no static import path reaches a real
 * client constructor" guarantee in index.ts's own header comment stays
 * intact. providers/openai.ts re-asserts this value against the real
 * `openai` SDK union type (`OPENAI_REASONING_EFFORT satisfies
 * OpenAI.Chat.ChatCompletionReasoningEffort`) at the one call site where
 * the SDK is legitimately in scope.
 *
 * WHY "none": gpt-5.6-luna is a reasoning model that returns HTTP 400
 * invalid_request_error for any /v1/chat/completions request carrying
 * `tools` unless `reasoning_effort` is explicitly `"none"` — vendor
 * message: "Function tools with reasoning_effort are not supported for
 * gpt-5.6-luna in /v1/chat/completions. To use function tools, use
 * /v1/responses or set reasoning_effort to 'none'." The first live
 * official run (2026-09-03) hit this on all 108 OpenAI requests (see
 * results/OPERATIONAL-FAILURE-NOTE.md). Setting `"none"`:
 *   - closes that failure on Chat Completions with no endpoint migration
 *     and no change to this adapter's response normalization, tool-call
 *     continuation, usage accounting, or error mapping;
 *   - is the FAIRNESS-CORRECT setting, not an advantage: the Anthropic
 *     adapter sends no extended-thinking parameter, so claude-haiku-4-5
 *     runs in its standard non-extended mode — `"none"` keeps both arms
 *     symmetric. Any other value would give OpenAI a private multi-step
 *     reasoning budget the paired Haiku run never gets, and would also
 *     make the recorded economical-tier pricing wrong (reasoning tokens
 *     bill as output).
 *
 * FROZEN. Like cases.ts / scoring.ts / decision.ts, this value must not
 * change between official runs. It is recorded verbatim in every run's
 * reproducibility metadata (report.ts's `openaiReasoningEffort`).
 */

/**
 * The exact `reasoning_effort` value sent on every OpenAI Chat
 * Completions request this benchmark makes. `"none"` = the private
 * reasoning pass is fully disabled, matching the Anthropic arm's own
 * standard (non-extended-thinking) configuration.
 */
export const OPENAI_REASONING_EFFORT = "none";
