import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../../fixtures/seed";
import { executeGetOrganizationSummary } from "@/lib/ai/tools/organization-summary";
import { executeSearchClients, executeGetClientDetail } from "@/lib/ai/tools/clients";
import { executeSearchProjects } from "@/lib/ai/tools/projects";
import { executeSearchTasks } from "@/lib/ai/tools/tasks";
import { registerAiTool } from "@/lib/ai/tools/registry";

/**
 * AI Assistant Batch 1B.1 — the shared adversarial suite every tool must
 * survive. No orchestration exists yet (no real model can construct these
 * arguments in Production today), so every case here directly calls each
 * tool's own `execute()` with a hand-crafted adversarial payload — the
 * same shape a future orchestrator would eventually forward from a real
 * model's tool-call JSON.
 */
describe("AI Batch 1B.1 — adversarial input suite", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  const searchTools: { name: string; execute: (organizationId: string, input: unknown) => Promise<{ ok: boolean; error?: string }> }[] = [
    { name: "searchClients", execute: executeSearchClients },
    { name: "searchProjects", execute: executeSearchProjects },
    { name: "searchTasks", execute: executeSearchTasks },
    { name: "getOrganizationSummary", execute: executeGetOrganizationSummary },
    { name: "getClientDetail", execute: executeGetClientDetail },
  ];

  it.each(searchTools)("$name: model tries to pass organizationId -> invalid_input, never used for scoping", async ({ execute }) => {
    const result = await execute(fixtures.orgA.id, { organizationId: fixtures.orgB.id });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_input");
  });

  it.each(searchTools)("$name: model tries to pass userId -> invalid_input", async ({ execute }) => {
    const result = await execute(fixtures.orgA.id, { userId: fixtures.owner.id });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_input");
  });

  it.each(searchTools)("$name: model tries limit=1000 -> invalid_input (no tool has a limit field at all)", async ({ execute }) => {
    const result = await execute(fixtures.orgA.id, { limit: 1000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_input");
  });

  it.each(searchTools)("$name: model tries a raw Prisma-shaped where clause -> invalid_input", async ({ execute }) => {
    const result = await execute(fixtures.orgA.id, { where: { organizationId: fixtures.orgB.id } });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_input");
  });

  it.each(searchTools)("$name: model tries a raw Prisma-shaped select clause -> invalid_input", async ({ execute }) => {
    const result = await execute(fixtures.orgA.id, { select: { email: true, notes: true } });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_input");
  });

  it("getClientDetail: a foreign organization's real, valid, raw UUID never returns data — indistinguishable from not_found", async () => {
    const result = await executeGetClientDetail(fixtures.orgA.id, { ref: fixtures.clientB.id });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("getClientDetail: a syntactically valid but entirely nonexistent UUID produces the exact same not_found", async () => {
    const result = await executeGetClientDetail(fixtures.orgA.id, { ref: randomUUID() });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("attempting to register a mutation-like tool alongside the approved five still fails, proving no bypass exists", () => {
    expect(() =>
      registerAiTool({ name: "deleteClient", description: "adversarial", inputSchema: {}, execute: async () => ({}) }),
    ).toThrow(/mutation-like/i);
  });

  describe("structural absence of untrusted free-text fields (no orchestrator needed to prove this)", () => {
    it("no output schema/type across Batch 1B.1 ever declares Client.notes", async () => {
      const result = await executeSearchClients(fixtures.orgA.id, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const item of result.results) {
        expect("notes" in item).toBe(false);
      }
      const detail = await executeGetClientDetail(fixtures.orgA.id, { ref: fixtures.clientA.id });
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect("notes" in detail).toBe(false);
      }
    });

    it("no output schema/type across Batch 1B.1 ever declares Project.description", async () => {
      const result = await executeSearchProjects(fixtures.orgA.id, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const item of result.results) {
        expect("description" in item).toBe(false);
      }
    });

    it("no output schema/type across Batch 1B.1 ever declares Task.description or assignee fields", async () => {
      const result = await executeSearchTasks(fixtures.orgA.id, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const item of result.results) {
        expect("description" in item).toBe(false);
        expect("assignee" in item).toBe(false);
        expect("assigneeEmail" in item).toBe(false);
      }
    });
  });
});
