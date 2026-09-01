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
  /** An opaque provider/model identifier string (e.g. "mock", or a future vendor's model name) — never a request or response body. */
  providerModelId?: string;
  latencyMs?: number;
  usage?: AiUsage;
  /** The tool's NAME only — see tools/registry.ts. Never the tool's input args or its result. */
  toolName?: string;
  category: AiLogEventCategory;
  errorKind?: AiProviderErrorKind;
  correlationId?: string;
};

const ALLOWED_KEYS = new Set<keyof AiLogMetadata>([
  "timestamp",
  "providerModelId",
  "latencyMs",
  "usage",
  "toolName",
  "category",
  "errorKind",
  "correlationId",
]);

/** A fresh, random, non-identifying value for one logged event — deliberately unrelated to any organizationId/userId, and never derived from one. */
export function generateAiRequestCorrelationId(): string {
  return randomUUID();
}

/**
 * The one function anything under src/lib/ai/** is allowed to log
 * through. Runtime-rejects any key outside AiLogMetadata's own allowed
 * set — a defensive check against a caller that bypasses the type system,
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
  console.log("[ai-assistant]", JSON.stringify(metadata));
}
