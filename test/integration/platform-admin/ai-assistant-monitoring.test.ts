import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getAiAssistantMonitoringSummary } from "@/lib/platform-admin/queries/ai-assistant-monitoring";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";

/**
 * AI Production Monitoring V1 — proves getAiAssistantMonitoringSummary()
 * against the real repository database harness (PGlite), mirroring
 * test/integration/platform-admin/failure-monitoring.test.ts's own shape
 * exactly (fixed reference instant, requirePlatformAdmin() mocked via a
 * real allowlisted identity, aggregate-only assertions).
 *
 * getAiAssistantMonitoringSummary() has no organization scoping at all —
 * it is deliberately platform-wide (see its own header comment) — so
 * every fixture in this file is anchored to a fixed reference instant far
 * in the past (REFERENCE_NOW) rather than the real wall clock, the same
 * collision-avoidance technique failure-monitoring.test.ts's own header
 * comment explains.
 */

const PLATFORM_ADMIN_TEST_EMAIL = "platform-admin-ai-monitoring-test@example.com";
const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;
const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;
const ORIGINAL_AQENRA_OPENAI_API_KEY = process.env.AQENRA_OPENAI_API_KEY;

const REFERENCE_NOW = new Date("2021-01-01T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const createdIds: string[] = [];

async function seedTurn(overrides: {
  outcome?: "SUCCESS" | "LIMIT_EXCEEDED" | "TIMEOUT" | "PROVIDER_ERROR" | "INVALID_RESPONSE" | "EMPTY_ANSWER" | "REF_LEAK";
  createdAt: Date;
  latencyMs?: number;
  providerCalls?: number;
  toolCalls?: number;
  toolNames?: string[];
  inputTokens?: number;
  outputTokens?: number;
}) {
  const row = await prisma.aiAssistantTurnTelemetry.create({
    data: {
      provider: "openai",
      model: "gpt-5.6-luna",
      outcome: overrides.outcome ?? "SUCCESS",
      createdAt: overrides.createdAt,
      latencyMs: overrides.latencyMs ?? 1000,
      providerCalls: overrides.providerCalls ?? 2,
      toolCalls: overrides.toolCalls ?? 1,
      toolNames: overrides.toolNames ?? ["searchClients"],
      inputTokens: overrides.inputTokens ?? 100,
      outputTokens: overrides.outputTokens ?? 50,
      correlationId: randomUUID(),
    },
  });
  createdIds.push(row.id);
  return row;
}

describe("getAiAssistantMonitoringSummary — AI Production Monitoring V1", () => {
  beforeAll(() => {
    process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_TEST_EMAIL;
    setMockAuthUser({ id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL });
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await prisma.aiAssistantTurnTelemetry.deleteMany({ where: { id: { in: createdIds } } });
    }
    resetAuthMock();
    if (ORIGINAL_PLATFORM_ADMIN_EMAILS === undefined) {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    } else {
      process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
    }
    if (ORIGINAL_AI_PROVIDER === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
    }
    if (ORIGINAL_AQENRA_OPENAI_API_KEY === undefined) {
      delete process.env.AQENRA_OPENAI_API_KEY;
    } else {
      process.env.AQENRA_OPENAI_API_KEY = ORIGINAL_AQENRA_OPENAI_API_KEY;
    }
  });

  describe("authorization", () => {
    it("requires Platform Admin authorization — a non-admin identity redirects rather than returning a summary", async () => {
      setMockAuthUser({ id: randomUUID(), email: "not-an-admin@example.com" });
      // requirePlatformAdmin() calls next/navigation's redirect(), which
      // throws a NEXT_REDIRECT-shaped error in a test/non-request
      // context — the same behavior failure-monitoring.test.ts's own
      // sibling queries rely on redirect() for; this proves the guard is
      // genuinely reached, not merely present in source.
      await expect(getAiAssistantMonitoringSummary(REFERENCE_NOW)).rejects.toThrow();
      setMockAuthUser({ id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL });
    });
  });

  describe("live status", () => {
    afterEach(() => {
      delete process.env.AI_PROVIDER;
      delete process.env.AQENRA_OPENAI_API_KEY;
    });

    it("reports disabled when AI_PROVIDER is unset — never exposes provider/model", async () => {
      delete process.env.AI_PROVIDER;
      delete process.env.AQENRA_OPENAI_API_KEY;
      const summary = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      expect(summary.liveStatus.configStatus).toBe("disabled");
      expect(summary.liveStatus.available).toBe(false);
      expect(summary.liveStatus.provider).toBeNull();
      expect(summary.liveStatus.model).toBeNull();
    });

    it("reports misconfigured when AI_PROVIDER=openai but the key is missing", async () => {
      process.env.AI_PROVIDER = "openai";
      delete process.env.AQENRA_OPENAI_API_KEY;
      const summary = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      expect(summary.liveStatus.configStatus).toBe("misconfigured");
      expect(summary.liveStatus.available).toBe(false);
      expect(summary.liveStatus.provider).toBeNull();
      expect(summary.liveStatus.model).toBeNull();
    });

    it("reports configured, with a safe provider/model, when both env vars are set — never an API key", async () => {
      process.env.AI_PROVIDER = "openai";
      process.env.AQENRA_OPENAI_API_KEY = "sk-test-not-a-real-key-marker-value";
      const summary = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      expect(summary.liveStatus.configStatus).toBe("configured");
      expect(summary.liveStatus.available).toBe(true);
      expect(summary.liveStatus.provider).toBe("openai");
      expect(summary.liveStatus.model).toBe("gpt-5.6-luna");

      const serialized = JSON.stringify(summary);
      expect(serialized).not.toContain("sk-test-not-a-real-key-marker-value");
    });
  });

  describe("turn aggregates", () => {
    it("counts totals/success/failure within the 7-day window, excluding older rows", async () => {
      await seedTurn({ outcome: "SUCCESS", createdAt: new Date(REFERENCE_NOW.getTime() - 1 * DAY_MS) });
      await seedTurn({ outcome: "SUCCESS", createdAt: new Date(REFERENCE_NOW.getTime() - 2 * DAY_MS) });
      await seedTurn({ outcome: "TIMEOUT", createdAt: new Date(REFERENCE_NOW.getTime() - 3 * DAY_MS) });
      // Outside the 7-day window — must be excluded.
      await seedTurn({ outcome: "SUCCESS", createdAt: new Date(REFERENCE_NOW.getTime() - 10 * DAY_MS) });

      const summary = await getAiAssistantMonitoringSummary(REFERENCE_NOW);

      expect(summary.turnAggregates.totalTurns).toBeGreaterThanOrEqual(3);
      const successBucket = summary.turnAggregates.outcomeBreakdown.find((b) => b.outcome === "SUCCESS");
      const timeoutBucket = summary.turnAggregates.outcomeBreakdown.find((b) => b.outcome === "TIMEOUT");
      expect(successBucket?.count).toBeGreaterThanOrEqual(2);
      expect(timeoutBucket?.count).toBeGreaterThanOrEqual(1);
    });

    it("computes successRatePct correctly from an isolated before/after delta", async () => {
      const before = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      const beforeTotal = before.turnAggregates.totalTurns;
      const beforeSuccess = before.turnAggregates.successCount;

      await seedTurn({ outcome: "SUCCESS", createdAt: new Date(REFERENCE_NOW.getTime() - 1 * DAY_MS) });
      await seedTurn({ outcome: "EMPTY_ANSWER", createdAt: new Date(REFERENCE_NOW.getTime() - 1 * DAY_MS) });

      const after = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      expect(after.turnAggregates.totalTurns).toBe(beforeTotal + 2);
      expect(after.turnAggregates.successCount).toBe(beforeSuccess + 1);
      expect(after.turnAggregates.failureCount).toBe(after.turnAggregates.totalTurns - after.turnAggregates.successCount);
      const expectedRate = Math.round((after.turnAggregates.successCount / after.turnAggregates.totalTurns) * 1000) / 10;
      expect(after.turnAggregates.successRatePct).toBe(expectedRate);
    });

    it("sums tokens/providerCalls/toolCalls and averages latency correctly — isolated before/after delta", async () => {
      const before = await getAiAssistantMonitoringSummary(REFERENCE_NOW);

      await seedTurn({
        createdAt: new Date(REFERENCE_NOW.getTime() - 1 * DAY_MS),
        latencyMs: 2000,
        providerCalls: 3,
        toolCalls: 2,
        inputTokens: 500,
        outputTokens: 200,
      });

      const after = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      expect(after.turnAggregates.totalInputTokens).toBe(before.turnAggregates.totalInputTokens + 500);
      expect(after.turnAggregates.totalOutputTokens).toBe(before.turnAggregates.totalOutputTokens + 200);
      expect(after.turnAggregates.totalProviderCalls).toBe(before.turnAggregates.totalProviderCalls + 3);
      expect(after.turnAggregates.totalToolCalls).toBe(before.turnAggregates.totalToolCalls + 2);
    });

    it("counts ref_leak events separately", async () => {
      const before = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      await seedTurn({ outcome: "REF_LEAK", createdAt: new Date(REFERENCE_NOW.getTime() - 1 * DAY_MS) });
      const after = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      expect(after.turnAggregates.refLeakCount).toBe(before.turnAggregates.refLeakCount + 1);
    });

    it("a turn entirely outside the 7-day window is excluded — isolated delta", async () => {
      const before = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      await seedTurn({ createdAt: new Date(REFERENCE_NOW.getTime() - 30 * DAY_MS) });
      const after = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      expect(after.turnAggregates.totalTurns).toBe(before.turnAggregates.totalTurns);
    });
  });

  describe("zero-state and privacy", () => {
    it("reports null successRatePct/averageLatencyMs and zero counts when there are no rows in an isolated far-future window", async () => {
      const emptyWindowNow = new Date("2015-01-01T00:00:00.000Z");
      const summary = await getAiAssistantMonitoringSummary(emptyWindowNow);
      expect(summary.turnAggregates.totalTurns).toBe(0);
      expect(summary.turnAggregates.successRatePct).toBeNull();
      expect(summary.turnAggregates.averageLatencyMs).toBeNull();
      expect(summary.turnAggregates.outcomeBreakdown).toEqual([]);
    });

    it("the summary's own JSON never contains a correlationId, an organizationId, or a userId", async () => {
      const row = await seedTurn({ createdAt: new Date(REFERENCE_NOW.getTime() - 1 * DAY_MS) });
      const summary = await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      const serialized = JSON.stringify(summary);
      expect(serialized).not.toContain(row.correlationId);
      expect(serialized).not.toContain("organizationId");
      expect(serialized).not.toContain("userId");
    });

    it("calling the summary never mutates a single AiAssistantTurnTelemetry row", async () => {
      const row = await seedTurn({ createdAt: new Date(REFERENCE_NOW.getTime() - 1 * DAY_MS) });
      await getAiAssistantMonitoringSummary(REFERENCE_NOW);
      const rowAfter = await prisma.aiAssistantTurnTelemetry.findUniqueOrThrow({ where: { id: row.id } });
      expect(rowAfter.outcome).toBe(row.outcome);
      expect(rowAfter.correlationId).toBe(row.correlationId);
    });
  });
});
