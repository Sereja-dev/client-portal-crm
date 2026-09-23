import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { AiAssistantTurnOutcome } from "@/generated/prisma/enums";

/**
 * AI Production Monitoring V1 — the durable, best-effort persistence
 * half of AI telemetry. A sibling to logging-policy.ts, not a merge into
 * it: logging-policy.ts owns the existing ephemeral console log event
 * (unchanged by this module); this module owns the new durable
 * AiAssistantTurnTelemetry row, following the exact same closed-shape,
 * runtime-validated discipline that file already established, and the
 * exact best-effort persistence pattern already proven in Production by
 * src/lib/client-portal/analytics-events.ts (recordPortalLogin /
 * recordPortalDownloadRequest) — awaited, wrapped in its own try/catch,
 * never rethrows, returns a boolean the caller is free to ignore, and on
 * failure emits only one fixed, sanitized console.error line plus a
 * single bounded two-value classification — never the raw thrown error,
 * never its message, never any identifier or content.
 *
 * AiTurnTelemetryInput's own type shape is the enforcement mechanism,
 * not a comment promising discipline: there is no `prompt`, `response`,
 * `toolArgs`, `toolResult`, `organizationId`, `userId`, or `metadata`
 * field anywhere in this type, so nothing calling
 * recordAiAssistantTurnTelemetry() with one of this module's own helpers
 * can accidentally carry that content through the type system.
 * recordAiAssistantTurnTelemetry() additionally runtime-validates its
 * input against this exact allowed-key set — the same defense-in-depth
 * discipline logging-policy.ts's own logAiAssistantEvent() already
 * established, against a caller that bypasses the type (e.g. an untyped
 * `as AiTurnTelemetryInput` cast) rather than trusting TypeScript alone.
 *
 * ONLY completed orchestration turns are ever recorded here — the
 * pre-auth 503 availability gate and the post-auth 429 rate-limit
 * rejection in src/app/api/ai/assistant/route.ts both return before
 * orchestrate.ts's own runAiAssistantTurn() is ever called, so neither
 * branch has any call site into this module at all (see
 * docs/production-observability-runbook.md's own AI Monitoring V1
 * section for the full write-amplification reasoning this restriction
 * exists to enforce). Never call this module from anywhere other than
 * orchestrate.ts's own turn-finalization path.
 */

const ALLOWED_TOOL_NAME_COUNT = 8;

export type AiTurnTelemetryInput = {
  /** Opaque provider identifier only — e.g. "openai", "mock" — never a vendor SDK object, request, or response body. Mirrors AiLogMetadata.provider (logging-policy.ts). */
  provider: string;
  /** Opaque model identifier only — e.g. "gpt-5.6-luna", "mock" — never a request or response body. Mirrors AiLogMetadata.model. */
  model: string;
  /** The full, un-collapsed AiOrchestrationResult outcome — never the existing console log event's own lossier errorKind mapping. See orchestrate.ts's own doc comment on why this must be read before toErrorKindForLog() runs. */
  outcome: AiAssistantTurnOutcome;
  latencyMs: number;
  providerCalls: number;
  toolCalls: number;
  /** Tool NAMES only, in call order — never args/results. Bounded by MAX_TOOL_CALLS_PER_TURN (orchestration-limits.ts); ALLOWED_TOOL_NAME_COUNT below is a defensive ceiling above that bound, not a design target. */
  toolNames: readonly string[];
  inputTokens: number;
  outputTokens: number;
  /** A fresh, random, non-reversible value — the same one generateAiRequestCorrelationId() already produces for the existing console log event. Never derived from organizationId/userId. */
  correlationId: string;
};

const ALLOWED_KEYS = new Set<keyof AiTurnTelemetryInput>([
  "provider",
  "model",
  "outcome",
  "latencyMs",
  "providerCalls",
  "toolCalls",
  "toolNames",
  "inputTokens",
  "outputTokens",
  "correlationId",
]);

const ALLOWED_OUTCOMES = new Set<AiAssistantTurnOutcome>([
  "SUCCESS",
  "LIMIT_EXCEEDED",
  "TIMEOUT",
  "PROVIDER_ERROR",
  "INVALID_RESPONSE",
  "EMPTY_ANSWER",
  "REF_LEAK",
]);

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/**
 * Exact-shape validation, the same "no field beyond what's named, no
 * value shape beyond what's declared" discipline logging-policy.ts's own
 * isValidUsage() already established for its one nested field. Rejects
 * anything outside AiTurnTelemetryInput's own allowed keys AND anything
 * that bypasses the type system with an invalid value shape (a non-array
 * toolNames, a non-string tool name, a negative/non-integer count, an
 * outcome outside the closed 7-value set).
 */
function assertValidTelemetryInput(input: AiTurnTelemetryInput): void {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key as keyof AiTurnTelemetryInput)) {
      throw new Error(
        `recordAiAssistantTurnTelemetry: unexpected field "${key}" — only ${[...ALLOWED_KEYS].join(", ")} may ever be persisted. Prompts, responses, tool arguments/results, and customer/tenant/user identifiers must never reach this function.`,
      );
    }
  }
  if (typeof input.provider !== "string" || input.provider.length === 0) {
    throw new Error(`recordAiAssistantTurnTelemetry: "provider" must be a non-empty string.`);
  }
  if (typeof input.model !== "string" || input.model.length === 0) {
    throw new Error(`recordAiAssistantTurnTelemetry: "model" must be a non-empty string.`);
  }
  if (!ALLOWED_OUTCOMES.has(input.outcome)) {
    throw new Error(`recordAiAssistantTurnTelemetry: "outcome" must be one of ${[...ALLOWED_OUTCOMES].join(", ")}.`);
  }
  for (const key of ["latencyMs", "providerCalls", "toolCalls", "inputTokens", "outputTokens"] as const) {
    if (!isNonNegativeInteger(input[key])) {
      throw new Error(`recordAiAssistantTurnTelemetry: "${key}" must be a finite, non-negative integer.`);
    }
  }
  if (!Array.isArray(input.toolNames)) {
    throw new Error(`recordAiAssistantTurnTelemetry: "toolNames" must be an array.`);
  }
  if (input.toolNames.length > ALLOWED_TOOL_NAME_COUNT) {
    throw new Error(`recordAiAssistantTurnTelemetry: "toolNames" exceeds the defensive ${ALLOWED_TOOL_NAME_COUNT}-entry ceiling.`);
  }
  if (!input.toolNames.every((name) => typeof name === "string" && name.length > 0)) {
    throw new Error(`recordAiAssistantTurnTelemetry: every "toolNames" entry must be a non-empty string.`);
  }
  if (typeof input.correlationId !== "string" || input.correlationId.length === 0) {
    throw new Error(`recordAiAssistantTurnTelemetry: "correlationId" must be a non-empty string.`);
  }
}

/** The one bounded, two-value failure classification this module ever logs — mirrors analytics-events.ts's own classifyAnalyticsFailure() exactly, including never reading any property of the thrown value. */
type TelemetryPersistenceFailureClassification = "known_error" | "unexpected";

function classifyTelemetryPersistenceFailure(err: unknown): TelemetryPersistenceFailureClassification {
  return err instanceof Prisma.PrismaClientKnownRequestError ? "known_error" : "unexpected";
}

/**
 * Best-effort, observational-only. A write failure here must never alter
 * the caller's own orchestration result, HTTP status, or the existing
 * console log event — see orchestrate.ts's own call site, which invokes
 * this strictly after the turn's own result is already finalized and
 * never inspects the boolean this function returns.
 *
 * A malformed `input` (the assertValidTelemetryInput() checks above)
 * throws synchronously, before any Prisma call — deliberately NOT caught
 * here, the same "a shape violation is a bug to fix, not a runtime
 * failure to swallow" discipline logAiAssistantEvent() already
 * establishes for its own equivalent checks. Only the Prisma write
 * itself (a genuine, expected-to-sometimes-happen runtime failure mode —
 * a connection drop, a constraint violation) is caught below.
 */
export async function recordAiAssistantTurnTelemetry(input: AiTurnTelemetryInput): Promise<boolean> {
  assertValidTelemetryInput(input);

  try {
    await prisma.aiAssistantTurnTelemetry.create({
      data: {
        provider: input.provider,
        model: input.model,
        outcome: input.outcome,
        latencyMs: input.latencyMs,
        providerCalls: input.providerCalls,
        toolCalls: input.toolCalls,
        toolNames: input.toolNames as Prisma.InputJsonValue,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        correlationId: input.correlationId,
      },
    });
    return true;
  } catch (err) {
    // Never the caught error object, never `.message`/`.stack`/`.cause`/
    // Prisma `meta`, never any dynamic serialization of what was thrown —
    // only the fixed message string below plus the one bounded
    // classification field.
    console.error("[ai-monitoring] Failed to record AI assistant turn telemetry.", {
      classification: classifyTelemetryPersistenceFailure(err),
    });
    return false;
  }
}
