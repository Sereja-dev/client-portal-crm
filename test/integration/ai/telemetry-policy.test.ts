import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordAiAssistantTurnTelemetry } from "@/lib/ai/telemetry-policy";

/**
 * AI Production Monitoring V1 — direct, real-Prisma integration coverage
 * for telemetry-policy.ts against the real test Postgres (PGlite), no
 * mocking. Mirrors test/integration/portal/analytics-events.test.ts's own
 * shape (the established best-effort-persistence integration pattern
 * this module's own doc comment cites) for the success path.
 *
 * The best-effort FAILURE path (returns false, never throws, exact
 * bounded classification, no raw error/identifier logged) is proven
 * thoroughly in test/unit/ai/telemetry-policy.test.ts instead, using a
 * REAL Prisma.PrismaClientKnownRequestError instance (not a loose
 * stand-in) constructed directly rather than thrown by a live
 * connection. Unlike PortalUser/PortalDownloadRequest (analytics-
 * events.test.ts's own precedent, which both have a natural FK/PK a
 * legitimate call can violate), AiAssistantTurnTelemetry deliberately has
 * no foreign key and no unique constraint beyond its own auto-generated
 * primary key (see its own schema.prisma doc comment on why no
 * organizationId/userId column exists) — there is no natural, in-schema
 * way for an ordinary application-level create() call to fail against a
 * healthy real Postgres here, and forcing one via e.g. `prisma.$disconnect()`
 * would risk destabilizing the shared PGlite connection pool for every
 * other test in this suite (no precedent for that technique exists
 * anywhere in this repo's own integration tier) for no proportional
 * benefit over the unit tier's own already-real-class-based proof.
 */
describe("recordAiAssistantTurnTelemetry — real Prisma", () => {
  const BASE_INPUT = {
    provider: "openai",
    model: "gpt-5.6-luna",
    outcome: "SUCCESS" as const,
    latencyMs: 2500,
    providerCalls: 2,
    toolCalls: 1,
    toolNames: ["searchClients"],
    inputTokens: 120,
    outputTokens: 40,
    correlationId: "11111111-1111-1111-1111-111111111111",
  };

  it("persists a real row with the exact given fields", async () => {
    const result = await recordAiAssistantTurnTelemetry(BASE_INPUT);
    expect(result).toBe(true);

    const rows = await prisma.aiAssistantTurnTelemetry.findMany({ where: { correlationId: BASE_INPUT.correlationId } });
    expect(rows).toHaveLength(1);

    expect(rows[0].provider).toBe("openai");
    expect(rows[0].model).toBe("gpt-5.6-luna");
    expect(rows[0].outcome).toBe("SUCCESS");
    expect(rows[0].latencyMs).toBe(2500);
    expect(rows[0].providerCalls).toBe(2);
    expect(rows[0].toolCalls).toBe(1);
    expect(rows[0].toolNames).toEqual(["searchClients"]);
    expect(rows[0].inputTokens).toBe(120);
    expect(rows[0].outputTokens).toBe(40);
    expect(rows[0].createdAt).toBeInstanceOf(Date);

    await prisma.aiAssistantTurnTelemetry.deleteMany({ where: { id: rows[0].id } });
  });

  it("round-trips an empty toolNames array as a real empty JSON array, not null/undefined", async () => {
    const correlationId = "44444444-4444-4444-4444-444444444444";
    await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, toolNames: [], correlationId });

    const row = await prisma.aiAssistantTurnTelemetry.findFirstOrThrow({ where: { correlationId } });
    expect(row.toolNames).toEqual([]);

    await prisma.aiAssistantTurnTelemetry.deleteMany({ where: { id: row.id } });
  });

  it("persists every closed outcome value without error", async () => {
    const outcomes = ["SUCCESS", "LIMIT_EXCEEDED", "TIMEOUT", "PROVIDER_ERROR", "INVALID_RESPONSE", "EMPTY_ANSWER", "REF_LEAK"] as const;
    const correlationIds = outcomes.map((_, i) => `22222222-2222-2222-2222-2222222222${String(10 + i)}`);

    for (const [i, outcome] of outcomes.entries()) {
      const result = await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, outcome, correlationId: correlationIds[i] });
      expect(result).toBe(true);
    }

    const rows = await prisma.aiAssistantTurnTelemetry.findMany({ where: { correlationId: { in: correlationIds } } });
    expect(rows.map((r) => r.outcome).sort()).toEqual([...outcomes].sort());

    await prisma.aiAssistantTurnTelemetry.deleteMany({ where: { correlationId: { in: correlationIds } } });
  });

  it("never persists a prompt/response/tool-content-shaped field — the row's own JSON serialization proves it", async () => {
    const correlationId = "55555555-5555-5555-5555-555555555555";
    await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, correlationId });

    const row = await prisma.aiAssistantTurnTelemetry.findFirstOrThrow({ where: { correlationId } });
    expect(Object.keys(row).sort()).toEqual(
      ["id", "createdAt", "provider", "model", "outcome", "latencyMs", "providerCalls", "toolCalls", "toolNames", "inputTokens", "outputTokens", "correlationId"].sort(),
    );

    await prisma.aiAssistantTurnTelemetry.deleteMany({ where: { id: row.id } });
  });
});
