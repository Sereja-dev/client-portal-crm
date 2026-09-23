import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platform-admin/authorization";
import { isAiAssistantAvailable } from "@/lib/ai/providers/provider-factory";
import { getOpenAiProviderConfig } from "@/lib/ai/providers/openai-config";
import { OPENAI_MODEL_ID } from "@/lib/ai/providers/openai";
import type { AiAssistantTurnOutcome } from "@/generated/prisma/enums";

/**
 * AI Production Monitoring V1 — the Platform Admin read model for the new
 * "AI Assistant" section of /platform-admin/observability (see that
 * page's own doc comment and docs/production-observability-runbook.md's
 * own AI Monitoring V1 section). Same enforcement convention as every
 * other Platform Admin query (failure-monitoring.ts, organizations.ts,
 * organization-detail.ts, platform-dashboard.ts): requirePlatformAdmin()
 * is called both in (platform-admin)/layout.tsx AND as the first awaited
 * operation inside getAiAssistantMonitoringSummary() itself below — see
 * failure-monitoring.ts's own header comment for the full
 * PLATFORM_ADMIN_EXECUTION_AUTHORIZATION_AUDIT citation this repeats.
 *
 * Two structurally separate halves, on purpose:
 *
 *   - Live status (isAiAssistantAvailable() / getOpenAiProviderConfig())
 *     — a synchronous, side-effect-free, always-current read, never
 *     persisted data. Deliberately answers "is AI available/configured
 *     right now," not "was it available at some point in the past" — see
 *     that runbook section's own "no 503 persistence" reasoning for why
 *     a historical event log was rejected in favor of this.
 *   - Turn aggregates (AiAssistantTurnTelemetry) — durable, bounded,
 *     aggregate-only Prisma reads over the last WINDOW_MS. Only ever
 *     completed orchestration turns exist in this table at all (see that
 *     model's own schema.prisma doc comment) — there is structurally
 *     nothing here from a rejected pre-auth/rate-limited request to
 *     aggregate in the first place.
 *
 * Never returns a raw telemetry row, a correlationId, or any per-turn
 * value — aggregate counts/sums/averages only, the same "aggregate-only,
 * never row-level" discipline failure-monitoring.ts's own header comment
 * establishes for its own four queries. No organizationId/userId
 * breakdown exists anywhere in this module, because none exists in the
 * underlying table to break down by (see AiAssistantTurnTelemetry's own
 * doc comment on why that column was never added).
 *
 * Deliberately does NOT attempt a tool-name aggregate: toolNames is a
 * JSON column (see AiAssistantTurnTelemetry's own doc comment on why —
 * this schema has no prior native-array-column convention), and
 * check-platform-admin-security.mjs forbids $queryRaw/$executeRaw
 * anywhere under src/lib/platform-admin, so there is no clean way to
 * aggregate its contents by SQL alone; the only alternative would be
 * loading every row in the window into application memory, which is
 * exactly the "arbitrary historical rows" this module's own task
 * explicitly says to avoid. Deferred, not overengineered — see the
 * runbook section's own explicit note.
 */

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type AiAssistantLiveStatus = {
  /** isAiAssistantAvailable() — TEST_MODE or a fully configured real provider. */
  available: boolean;
  /** getOpenAiProviderConfig().status — "disabled" | "misconfigured" | "configured". Independent of `available` above (TEST_MODE can make `available` true while this still reads "disabled" — both are reported exactly as each function returns them, never reconciled into a single derived state). */
  configStatus: "disabled" | "misconfigured" | "configured";
  /** Only present when configStatus is "configured" — never a guess, never shown alongside "disabled"/"misconfigured". */
  provider: "openai" | null;
  model: string | null;
};

export type AiAssistantOutcomeBucket = {
  outcome: AiAssistantTurnOutcome;
  count: number;
};

export type AiAssistantTurnAggregates = {
  windowStart: Date;
  generatedAt: Date;
  totalTurns: number;
  successCount: number;
  failureCount: number;
  /** Rounded to one decimal place; null when totalTurns is 0 (no meaningful rate to show). */
  successRatePct: number | null;
  outcomeBreakdown: AiAssistantOutcomeBucket[];
  /** null when totalTurns is 0 — an average of zero rows is not a real "0ms", it's "no data yet". */
  averageLatencyMs: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalProviderCalls: number;
  totalToolCalls: number;
  refLeakCount: number;
};

export type AiAssistantMonitoringSummary = {
  liveStatus: AiAssistantLiveStatus;
  turnAggregates: AiAssistantTurnAggregates;
};

function assertSafeCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Unexpected non-safe-integer aggregate count for ${label}`);
  }
  return value;
}

function readLiveStatus(): AiAssistantLiveStatus {
  const configResult = getOpenAiProviderConfig();
  const available = isAiAssistantAvailable();
  if (configResult.status === "configured") {
    return { available, configStatus: "configured", provider: "openai", model: OPENAI_MODEL_ID };
  }
  return { available, configStatus: configResult.status, provider: null, model: null };
}

/**
 * `now` is injectable only for deterministic testing — the caller is
 * always this module's own page, never a client-supplied value (mirrors
 * getFailureMonitoringSummary(now)'s own convention exactly).
 */
export async function getAiAssistantMonitoringSummary(now: Date = new Date()): Promise<AiAssistantMonitoringSummary> {
  await requirePlatformAdmin();

  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const where = { createdAt: { gte: windowStart, lte: now } };

  const [outcomeGroups, latencyAggregate, tokenAndCallAggregate] = await Promise.all([
    prisma.aiAssistantTurnTelemetry.groupBy({ by: ["outcome"], where, _count: true }),
    prisma.aiAssistantTurnTelemetry.aggregate({ where, _avg: { latencyMs: true } }),
    prisma.aiAssistantTurnTelemetry.aggregate({
      where,
      _sum: { inputTokens: true, outputTokens: true, providerCalls: true, toolCalls: true },
    }),
  ]);

  const outcomeBreakdown: AiAssistantOutcomeBucket[] = outcomeGroups
    .map((group) => ({ outcome: group.outcome, count: assertSafeCount(group._count, "outcomeBreakdown") }))
    .sort((a, b) => a.outcome.localeCompare(b.outcome));

  const totalTurns = assertSafeCount(
    outcomeBreakdown.reduce((sum, bucket) => sum + bucket.count, 0),
    "totalTurns",
  );
  const successCount = outcomeBreakdown.find((b) => b.outcome === "SUCCESS")?.count ?? 0;
  const failureCount = assertSafeCount(totalTurns - successCount, "failureCount");
  const refLeakCount = outcomeBreakdown.find((b) => b.outcome === "REF_LEAK")?.count ?? 0;

  return {
    liveStatus: readLiveStatus(),
    turnAggregates: {
      windowStart,
      generatedAt: now,
      totalTurns,
      successCount: assertSafeCount(successCount, "successCount"),
      failureCount,
      successRatePct: totalTurns > 0 ? Math.round((successCount / totalTurns) * 1000) / 10 : null,
      outcomeBreakdown,
      averageLatencyMs: totalTurns > 0 ? Math.round(latencyAggregate._avg.latencyMs ?? 0) : null,
      totalInputTokens: assertSafeCount(tokenAndCallAggregate._sum.inputTokens ?? 0, "totalInputTokens"),
      totalOutputTokens: assertSafeCount(tokenAndCallAggregate._sum.outputTokens ?? 0, "totalOutputTokens"),
      totalProviderCalls: assertSafeCount(tokenAndCallAggregate._sum.providerCalls ?? 0, "totalProviderCalls"),
      totalToolCalls: assertSafeCount(tokenAndCallAggregate._sum.toolCalls ?? 0, "totalToolCalls"),
      refLeakCount: assertSafeCount(refLeakCount, "refLeakCount"),
    },
  };
}
