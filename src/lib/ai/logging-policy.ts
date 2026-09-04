import { randomUUID } from "node:crypto";
import type { AiProviderErrorKind, AiUsage } from "./provider";

/**
 * AI Assistant Batch 1A — the metadata-only logging contract. Fits this
 * codebase's existing pull-only observability model (see
 * docs/production-observability-runbook.md and the Platform Admin
 * Observability page, §9 of that runbook) exactly: nothing here pushes to
 * an external log aggregator, and nothing here ever carries the kind of
 * content that model needs to stay privacy-safe.
 *
 * AiLogMetadata's own type shape is the enforcement mechanism, not a
 * comment promising discipline: there is no `prompt`, `response`,
 * `toolArgs`, `toolResult`, `organizationId`, `userId`, or `email` field
 * anywhere in this type, so nothing calling logAiAssistantEvent() with
 * one of this module's own helpers can accidentally carry that content
 * through the type system. logAiAssistantEvent() additionally
 * runtime-validates its input against this exact allowed-key set — a
 * defense-in-depth check against a caller that bypasses the type (e.g. an
 * untyped `as AiLogMetadata` cast, or a future JS caller) rather than
 * trusting TypeScript alone (see test/unit/ai/logging-policy.test.ts,
 * which asserts this rejection directly).
 *
 * `correlationId` is a fresh, random, non-reversible value generated
 * specifically for one logged event (see generateAiRequestCorrelationId())
 * — never organizationId/userId themselves, and never derived from them.
 * If tenant-level aggregate correlation is ever genuinely required later,
 * that needs its own explicit, reviewed pseudonymization design — not
 * introduced here, and not achieved by quietly logging a raw
 * organizationId "just this once."
 */

export type AiLogEventCategory = "success" | "error";

export type AiLogMetadata = {
  timestamp: string;
  /** Opaque provider identifier only — e.g. "mock", "unconfigured", "openai" — never a vendor SDK object, request, or response body. See AiProvider.providerId. */
  provider?: string;
  /** Opaque model identifier only — e.g. "mock", "gpt-5.6-luna" — never a request or response body. See AiProvider.modelId. */
  model?: string;
  latencyMs?: number;
  usage?: AiUsage;
  /** The tool's NAME only — see tools/registry.ts. Never the tool's input args or its result. */
  toolName?: string;
  /** Count of provider.complete() invocations this turn made — a plain integer, never provider-call content. */
  providerCallCount?: number;
  /** Count of tool calls this turn dispatched — a plain integer, never tool-call content. */
  toolCallCount?: number;
  category: AiLogEventCategory;
  errorKind?: AiProviderErrorKind;
  correlationId?: string;
};

const ALLOWED_KEYS = new Set<keyof AiLogMetadata>([
  "timestamp",
  "provider",
  "model",
  "latencyMs",
  "usage",
  "toolName",
  "providerCallCount",
  "toolCallCount",
  "category",
  "errorKind",
  "correlationId",
]);

/** A fresh, random, non-identifying value for one logged event — deliberately unrelated to any organizationId/userId, and never derived from one. */
export function generateAiRequestCorrelationId(): string {
  return randomUUID();
}

/**
 * Hardening finding A (found during the Batch 1A merge audit, closed
 * here): the top-level key check above only validated `metadata`'s own
 * OWN keys — a caller that bypasses the type system (e.g. an untyped
 * `as AiLogMetadata` cast, or a value assembled from a variable rather
 * than an object literal, which TypeScript's own excess-property check
 * never covers) could smuggle an extra field inside the one nested
 * object this shape allows, `usage`, and it would sail through
 * unexamined — `usage` was passed through as an opaque blob, never
 * itself validated. Exact-shape validation, not JSON-stringify-and-scan:
 * `usage`, when present, must have exactly the three AiUsage keys
 * (promptTokens/completionTokens/totalTokens), each a finite,
 * non-negative number — nothing more, nothing looser.
 */
const ALLOWED_USAGE_KEYS = new Set<keyof AiUsage>(["promptTokens", "completionTokens", "totalTokens"]);

function isValidUsage(value: unknown): value is AiUsage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  // Exactly the three allowed keys — no fewer (AiUsage's own type has
  // none of them optional), no more (that's the actual bypass this
  // closes).
  if (keys.length !== ALLOWED_USAGE_KEYS.size || !keys.every((key) => ALLOWED_USAGE_KEYS.has(key as keyof AiUsage))) {
    return false;
  }
  return Object.values(record).every((count) => typeof count === "number" && Number.isFinite(count) && count >= 0);
}

/**
 * The one function anything under src/lib/ai/** is allowed to log
 * through. Runtime-rejects any key outside AiLogMetadata's own allowed
 * set, AND (see isValidUsage's own doc comment above) any unexpected key
 * or invalid value hidden inside the one nested field this shape allows
 * — a defensive check against a caller that bypasses the type system,
 * not a claim that the type system alone is insufficient in normal use.
 */
export function logAiAssistantEvent(metadata: AiLogMetadata): void {
  for (const key of Object.keys(metadata)) {
    if (!ALLOWED_KEYS.has(key as keyof AiLogMetadata)) {
      throw new Error(
        `logAiAssistantEvent: unexpected field "${key}" — only metadata (${[...ALLOWED_KEYS].join(", ")}) may ever be logged for the AI Assistant. Prompts, responses, tool arguments/results, and customer content must never reach this function.`,
      );
    }
  }
  if (metadata.usage !== undefined && !isValidUsage(metadata.usage)) {
    throw new Error(
      `logAiAssistantEvent: "usage" must contain exactly promptTokens/completionTokens/totalTokens as finite, non-negative numbers — no other field, and no other value shape, may ever be logged.`,
    );
  }
  for (const key of ["providerCallCount", "toolCallCount"] as const) {
    const value = metadata[key];
    if (value !== undefined && !(typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value))) {
      throw new Error(`logAiAssistantEvent: "${key}" must be a finite, non-negative integer.`);
    }
  }
  console.log("[ai-assistant]", JSON.stringify(metadata));
}
