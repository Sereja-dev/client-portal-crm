/**
 * AI Assistant orchestration + Route Handler batch. The one closed
 * validator for POST /api/ai/assistant's request body — mirrors this
 * codebase's own established tool-input-validation discipline
 * (tools/validation.ts's own hasOnlyAllowedKeys/isPlainObject) rather
 * than inventing a new parsing convention for the one place a real HTTP
 * body reaches this feature.
 *
 * Single-turn only, by design (the approved architecture's own explicit
 * choice — see the batch plan's own §6): the request body is EXACTLY
 * `{ message: string }`. No `organizationId` (resolved server-side only,
 * from getAiAssistantRequestContext() — never accepted from a client),
 * no `userId`, no `history` (no client-supplied conversation history in
 * this batch), no `provider`/`mockScenario` (provider selection is a
 * server-only concern — see providers/provider-factory.ts — never
 * client-influenced), no `limit`/tool-config-shaped key of any kind.
 *
 * No permissive parse-and-ignore behavior anywhere here: an unknown key,
 * a wrong-typed `message`, or an oversized/empty-after-trim `message` are
 * all rejected outright as invalid_input — never silently dropped or
 * coerced, matching every existing AI tool's own `hasOnlyAllowedKeys`
 * contract.
 */

import { MAX_USER_MESSAGE_CHARS } from "./orchestration-limits";

const ALLOWED_KEYS = ["message"] as const;

export type AiAssistantRequestBody = { message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

/**
 * Validates and normalizes a parsed JSON body. Length is checked BEFORE
 * trimming (a message padded with whitespace past the limit is rejected,
 * not silently shortened to fit); the trimmed value is what
 * runAiAssistantTurn() actually receives. A message that is empty (or
 * whitespace-only) after trimming is invalid — never coerced into a
 * placeholder, and never allowed to reach the provider as an empty user
 * turn.
 */
export function validateAiAssistantRequestBody(rawBody: unknown): { message: string } | null {
  if (!isPlainObject(rawBody)) {
    return null;
  }
  if (!hasOnlyAllowedKeys(rawBody, ALLOWED_KEYS)) {
    return null;
  }

  const { message } = rawBody;
  if (typeof message !== "string") {
    return null;
  }
  if (message.length > MAX_USER_MESSAGE_CHARS) {
    return null;
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return { message: trimmed };
}
