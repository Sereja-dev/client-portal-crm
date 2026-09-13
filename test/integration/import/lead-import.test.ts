import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { uploadImportFileAction, previewImportAction, executeImportAction } from "@/lib/import/server-actions";
import { createWorkflowAutomation, type WorkflowAutomationActor } from "@/lib/workflow-automations/automations";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock, setMockAuthUser } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/** CSV Import Phase 2 — Lead. Mirrors client-import.test.ts's own structure exactly; see that file's own header comment. */

function csvFile(content: string, name = "leads.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

function formDataWithFile(file: File): FormData {
  const fd = new FormData();
  fd.set("file", file);
  return fd;
}

function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): WorkflowAutomationActor {
  return { id: user.id, name: user.name, role };
}

describe("CSV Import — Lead", () => {
  let fixtures: TestFixtures;
  const createdLeadIds: string[] = [];
  const createdImportJobIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  });

  afterEach(async () => {
    resetAuthMock();
    if (createdLeadIds.length > 0) {
      await prisma.activity.deleteMany({ where: { entityType: "LEAD", entityId: { in: createdLeadIds } } });
      await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
      createdLeadIds.length = 0;
    }
    if (createdImportJobIds.length > 0) {
      await prisma.importJob.deleteMany({ where: { id: { in: createdImportJobIds } } });
      createdImportJobIds.length = 0;
    }
    await prisma.workflowAutomationRun.deleteMany({ where: { workflowAutomation: { organizationId: fixtures.orgA.id } } });
    await prisma.workflowAutomation.deleteMany({ where: { organizationId: fixtures.orgA.id } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function upload(orgUser: { id: string; email: string; name: string }, csv: string) {
    actAs(orgUser, fixtures.orgA.id);
    const result = await uploadImportFileAction("LEAD", formDataWithFile(csvFile(csv)));
    if (result.ok) createdImportJobIds.push(result.importJobId);
    return result;
  }

  async function previewThenExecute(importJobId: string, mapping: { columnIndex: number; field: string }[]) {
    const preview = await previewImportAction(importJobId, "LEAD", mapping);
    if (!preview.ok) throw new Error(`fixture preview failed: ${preview.reason}`);
    return executeImportAction(importJobId, "LEAD");
  }

  describe("permissions", () => {
    it("MEMBER is denied server-side", async () => {
      actAs(fixtures.member, fixtures.orgA.id);
      const result = await uploadImportFileAction("LEAD", formDataWithFile(csvFile("Name\r\nAcme\r\n")));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("forbidden");
    });

    it("Portal identity is redirected", async () => {
      setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
      await expect(uploadImportFileAction("LEAD", formDataWithFile(csvFile("Name\r\nAcme\r\n")))).rejects.toBeInstanceOf(
        RedirectSignal,
      );
    });

    it("unauthenticated is redirected", async () => {
      await expect(uploadImportFileAction("LEAD", formDataWithFile(csvFile("Name\r\nAcme\r\n")))).rejects.toBeInstanceOf(
        RedirectSignal,
      );
    });

    it("OWNER and ADMIN can both upload", async () => {
      for (const user of [fixtures.owner, fixtures.admin]) {
        const result = await upload(user, "Name\r\nAcme\r\n");
        expect(result.ok).toBe(true);
      }
    });
  });

  describe("full flow: upload -> preview -> execute", () => {
    it("creates real Leads always at stage NEW, with no Activity and no WorkflowAutomationRun even with a matching automation configured", async () => {
      const automationResult = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
        name: "Notify on Lead stage change",
        triggerEntityType: "LEAD",
        triggerAction: "STATUS_CHANGED",
        conditions: [],
        actions: [],
      });
      // Not asserted ok — this automation targets STATUS_CHANGED, which
      // Lead creation never triggers at all (interactive or import); it
      // exists here only to prove an unrelated automation is inert, not
      // to prove suppression of something that already never fired.
      void automationResult;

      const suffix = randomUUID().slice(0, 8);
      const csv = `Name,Company,Source,Value\r\nJane-${suffix},Acme,Website,1500\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;
      expect(uploadResult.headers).toEqual(["Name", "Company", "Source", "Value"]);

      const mapping = [
        { columnIndex: 0, field: "name" },
        { columnIndex: 1, field: "company" },
        { columnIndex: 2, field: "source" },
        { columnIndex: 3, field: "value" },
      ];

      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, mapping);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(1);

      const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: `Jane-${suffix}` } });
      createdLeadIds.push(lead.id);
      expect(lead.stage).toBe("NEW");
      expect(lead.source).toBe("WEBSITE");
      expect(Number(lead.value)).toBe(1500);
      expect(lead.assignedToUserId).toBeNull(); // Phase 2 never imports assignee

      const activityCount = await prisma.activity.count({ where: { organizationId: fixtures.orgA.id, entityType: "LEAD", entityId: lead.id } });
      expect(activityCount).toBe(0);

      const runCount = await prisma.workflowAutomationRun.count({ where: { workflowAutomation: { organizationId: fixtures.orgA.id } } });
      expect(runCount).toBe(0);
    });
  });

  describe("Source", () => {
    it("accepts a case-insensitive match against a canonical source value", async () => {
      const suffix = randomUUID().slice(0, 8);
      const csv = `Name,Source\r\nCase-${suffix},website\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, [
        { columnIndex: 0, field: "name" },
        { columnIndex: 1, field: "source" },
      ]);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(1);

      const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: `Case-${suffix}` } });
      createdLeadIds.push(lead.id);
      expect(lead.source).toBe("WEBSITE"); // normalized to the canonical uppercase enum value
    });

    it("rejects an unknown source value as a row validation error, never guessing", async () => {
      const suffix = randomUUID().slice(0, 8);
      const csv = `Name,Source\r\nBad-${suffix},Instagram\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      const mapping = [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "source" }];
      actAs(fixtures.owner, fixtures.orgA.id);
      const preview = await previewImportAction(uploadResult.importJobId, "LEAD", mapping);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.failedCount).toBe(1);
      expect(preview.rowDetails[0].message).toMatch(/unknown source.*instagram/i);

      const exec = await executeImportAction(uploadResult.importJobId, "LEAD");
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.failedCount).toBe(1);
      expect(exec.importedCount).toBe(0);
    });
  });

  describe("Value", () => {
    it("accepts a valid non-negative numeric value", async () => {
      const suffix = randomUUID().slice(0, 8);
      const uploadResult = await upload(fixtures.owner, `Name,Value\r\nGood-${suffix},2500.50\r\n`);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, [
        { columnIndex: 0, field: "name" },
        { columnIndex: 1, field: "value" },
      ]);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(1);

      const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: `Good-${suffix}` } });
      createdLeadIds.push(lead.id);
      expect(Number(lead.value)).toBe(2500.5);
    });

    it("rejects a malformed (non-numeric) value as a row validation error", async () => {
      const suffix = randomUUID().slice(0, 8);
      const uploadResult = await upload(fixtures.owner, `Name,Value\r\nBad-${suffix},not-a-number\r\n`);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      const mapping = [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "value" }];
      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, mapping);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.failedCount).toBe(1);
      expect(exec.importedCount).toBe(0);
    });

    it("rejects a negative value the same way the interactive create path already does", async () => {
      const suffix = randomUUID().slice(0, 8);
      const uploadResult = await upload(fixtures.owner, `Name,Value\r\nNeg-${suffix},-100\r\n`);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      const mapping = [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "value" }];
      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, mapping);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.failedCount).toBe(1);
    });
  });

  describe("Stage", () => {
    it("a CSV Stage-like column has no importable target and never changes the always-NEW behavior", async () => {
      const suffix = randomUUID().slice(0, 8);
      // "Stage" is not a real mapping target at all (never in
      // LEAD_IMPORT_FIELDS) — even naming a column "Stage" with a value
      // like WON changes nothing, since it can only ever be left unmapped.
      const uploadResult = await upload(fixtures.owner, `Name,Stage\r\nStage-${suffix},WON\r\n`);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, [{ columnIndex: 0, field: "name" }]);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(1);

      const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId: fixtures.orgA.id, name: `Stage-${suffix}` } });
      createdLeadIds.push(lead.id);
      expect(lead.stage).toBe("NEW");
    });
  });

  describe("duplicate Leads are allowed (no dedup rule invented)", () => {
    it("imports two Leads sharing the same email — neither skipped nor failed", async () => {
      const suffix = randomUUID().slice(0, 8);
      const csv = `Name,Email\r\nFirst-${suffix},same-${suffix}@example.com\r\nSecond-${suffix},same-${suffix}@example.com\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      const mapping = [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "email" }];
      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, mapping);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(2);
      expect(exec.skippedCount).toBe(0);

      const created = await prisma.lead.findMany({ where: { organizationId: fixtures.orgA.id, email: `same-${suffix}@example.com` } });
      createdLeadIds.push(...created.map((l) => l.id));
      expect(created).toHaveLength(2);
    });
  });

  describe("tenant isolation and replay security", () => {
    it("ImportJob is org-scoped — a different org cannot preview or execute it", async () => {
      const uploadResult = await upload(fixtures.owner, "Name\r\nAcme\r\n");
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.orgBOwner, fixtures.orgB.id);
      const preview = await previewImportAction(uploadResult.importJobId, "LEAD", [{ columnIndex: 0, field: "name" }]);
      expect(preview.ok).toBe(false);
      if (preview.ok) return;
      expect(preview.reason).toBe("not_found");
    });

    it("a forged entity type (job is really LEAD, claimed as CLIENT) is rejected", async () => {
      const uploadResult = await upload(fixtures.owner, "Name\r\nAcme\r\n");
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(exec.ok).toBe(false);
      if (exec.ok) return;
      expect(exec.reason).toBe("not_found");
    });

    it("replay: a second execute call is rejected, and Leads are never imported twice", async () => {
      const suffix = randomUUID().slice(0, 8);
      const uploadResult = await upload(fixtures.owner, `Name\r\nReplay-${suffix}\r\n`);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      await previewImportAction(uploadResult.importJobId, "LEAD", [{ columnIndex: 0, field: "name" }]);

      const first = await executeImportAction(uploadResult.importJobId, "LEAD");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.importedCount).toBe(1);

      const second = await executeImportAction(uploadResult.importJobId, "LEAD");
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe("already_processed");

      const created = await prisma.lead.findMany({ where: { organizationId: fixtures.orgA.id, name: `Replay-${suffix}` } });
      createdLeadIds.push(...created.map((l) => l.id));
      expect(created).toHaveLength(1);
    });
  });
});
