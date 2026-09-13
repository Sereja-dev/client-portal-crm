import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  uploadImportFileAction,
  previewImportAction,
  executeImportAction,
} from "@/lib/import/server-actions";
import { createWorkflowAutomation, type WorkflowAutomationActor } from "@/lib/workflow-automations/automations";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { MAX_IMPORT_FILE_SIZE_BYTES, MAX_IMPORT_ROWS } from "@/lib/import/constants";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock, setMockAuthUser } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * CSV Import Phase 2 — Client. Real Prisma/PGlite throughout (nothing
 * mocked except the standard integration-harness auth/navigation seams
 * every other Server Action test already relies on).
 */

function csvFile(content: string, name = "clients.csv"): File {
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

describe("CSV Import — Client", () => {
  let fixtures: TestFixtures;
  const createdClientIds: string[] = [];
  const createdImportJobIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
    // seedTestData() creates orgA/orgB via a raw prisma.organization.create
    // (not the getOrCreateOrganizationId path that normally bootstraps
    // this) — createClientCore's own "current default status" resolution
    // needs a real default CustomStatusDefinition to exist, same
    // precondition test/integration/workflow-automations/execution.test.ts
    // already establishes identically for its own fixtures.orgA.
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  });

  afterEach(async () => {
    resetAuthMock();
    if (createdClientIds.length > 0) {
      await prisma.clientContact.deleteMany({ where: { clientId: { in: createdClientIds } } });
      await prisma.activity.deleteMany({ where: { entityType: "CLIENT", entityId: { in: createdClientIds } } });
      await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
      createdClientIds.length = 0;
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
    const result = await uploadImportFileAction("CLIENT", formDataWithFile(csvFile(csv)));
    if (result.ok) createdImportJobIds.push(result.importJobId);
    return result;
  }

  /** Preview (which persists the mapping the execute step then reads back) must always run before execute — this mirrors the real wizard's own step order, and is what actually makes the mapping authoritative server-side rather than trusted from the client at confirm time. */
  async function previewThenExecute(importJobId: string, mapping: { columnIndex: number; field: string }[]) {
    const preview = await previewImportAction(importJobId, "CLIENT", mapping);
    if (!preview.ok) throw new Error(`fixture preview failed: ${preview.reason}`);
    return executeImportAction(importJobId, "CLIENT");
  }

  describe("permissions", () => {
    it("MEMBER is denied server-side, never uploads", async () => {
      actAs(fixtures.member, fixtures.orgA.id);
      const result = await uploadImportFileAction("CLIENT", formDataWithFile(csvFile("Name\r\nAcme\r\n")));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("forbidden");
    });

    it("Portal identity is redirected, never reaches the import action", async () => {
      setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
      await expect(uploadImportFileAction("CLIENT", formDataWithFile(csvFile("Name\r\nAcme\r\n")))).rejects.toBeInstanceOf(
        RedirectSignal,
      );
    });

    it("unauthenticated is redirected", async () => {
      await expect(uploadImportFileAction("CLIENT", formDataWithFile(csvFile("Name\r\nAcme\r\n")))).rejects.toBeInstanceOf(
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

  describe("file validation", () => {
    it("rejects a non-.csv file by extension", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const result = await uploadImportFileAction(
        "CLIENT",
        formDataWithFile(new File(["Name\r\nAcme\r\n"], "clients.txt", { type: "text/plain" })),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid_extension");
    });

    it("rejects a file over the 10 MB cap", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const oversized = "Name\r\n" + "A".repeat(MAX_IMPORT_FILE_SIZE_BYTES + 1);
      const result = await uploadImportFileAction("CLIENT", formDataWithFile(csvFile(oversized)));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("file_too_large");
    });

    it("rejects a file exceeding the row-count ceiling", async () => {
      const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Row-${i}`).join("\r\n");
      const result = await upload(fixtures.owner, `Name\r\n${rows}\r\n`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("parse_error");
    });
  });

  describe("full flow: upload -> preview -> execute", () => {
    it("creates real Clients with primary contacts, no Activity, no WorkflowAutomationRun — even with a matching CLIENT.CREATED automation configured", async () => {
      const statusDefinition = await prisma.customStatusDefinition.findFirstOrThrow({
        where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "active" },
      });
      const automationResult = await createWorkflowAutomation(fixtures.orgA.id, actorFor(fixtures.owner, "OWNER"), {
        name: "Set active status on Client creation",
        triggerEntityType: "CLIENT",
        triggerAction: "CREATED",
        conditions: [],
        actions: [{ type: "SET_CUSTOM_STATUS", customStatusDefinitionId: statusDefinition.id }],
      });
      if (!automationResult.ok) throw new Error("fixture automation create failed");

      const suffix = randomUUID().slice(0, 8);
      const csv = `Name,Email,Company\r\nJane-${suffix},jane-${suffix}@example.com,Acme\r\nJohn-${suffix},,Widgets\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;
      expect(uploadResult.headers).toEqual(["Name", "Email", "Company"]);
      expect(uploadResult.totalRows).toBe(2);

      const mapping = [
        { columnIndex: 0, field: "name" },
        { columnIndex: 1, field: "email" },
        { columnIndex: 2, field: "company" },
      ];

      actAs(fixtures.owner, fixtures.orgA.id);
      const preview = await previewImportAction(uploadResult.importJobId, "CLIENT", mapping);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.totalRows).toBe(2);
      expect(preview.validCount).toBe(2);
      expect(preview.skippedCount).toBe(0);
      expect(preview.failedCount).toBe(0);

      const exec = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(2);
      expect(exec.skippedCount).toBe(0);
      expect(exec.failedCount).toBe(0);

      const clients = await prisma.client.findMany({
        where: { organizationId: fixtures.orgA.id, name: { in: [`Jane-${suffix}`, `John-${suffix}`] } },
        include: { contacts: true },
      });
      createdClientIds.push(...clients.map((c) => c.id));
      expect(clients).toHaveLength(2);

      const jane = clients.find((c) => c.name === `Jane-${suffix}`)!;
      expect(jane.company).toBe("Acme");
      expect(jane.contacts.some((c) => c.isPrimary && c.email === `jane-${suffix}@example.com`)).toBe(true);

      const john = clients.find((c) => c.name === `John-${suffix}`)!;
      expect(john.contacts).toHaveLength(0); // no email/phone -> no primary contact auto-created

      // Import-specific status semantics: "use the existing default/
      // current create semantics" — never the automation's own action,
      // which never ran (no Activity to trigger it).
      const systemLeadDefinition = await prisma.customStatusDefinition.findFirstOrThrow({
        where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true, key: "lead" },
      });
      expect(jane.statusDefinitionId).toBe(systemLeadDefinition.id);

      const activityCount = await prisma.activity.count({
        where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", entityId: { in: clients.map((c) => c.id) } },
      });
      expect(activityCount).toBe(0);

      const runCount = await prisma.workflowAutomationRun.count({
        where: { workflowAutomationId: automationResult.workflowAutomation.id },
      });
      expect(runCount).toBe(0);
    });

    it("field-level validation errors are reported per row, without blocking the rest of the file", async () => {
      const suffix = randomUUID().slice(0, 8);
      const csv = `Name,Email\r\nGood-${suffix},good-${suffix}@example.com\r\n,bad-${suffix}@example.com\r\nBad-Email-${suffix},not-an-email\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      const mapping = [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "email" }];
      actAs(fixtures.owner, fixtures.orgA.id);
      const preview = await previewImportAction(uploadResult.importJobId, "CLIENT", mapping);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.validCount).toBe(1);
      expect(preview.failedCount).toBe(2);
      expect(preview.rowDetails.some((r) => r.row === 3 && r.message?.includes("Name"))).toBe(true);
      expect(preview.rowDetails.some((r) => r.row === 4 && r.message?.includes("Email"))).toBe(true);

      const exec = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(1);
      expect(exec.failedCount).toBe(2);

      const created = await prisma.client.findMany({ where: { organizationId: fixtures.orgA.id, name: `Good-${suffix}` } });
      createdClientIds.push(...created.map((c) => c.id));
      expect(created).toHaveLength(1);
    });
  });

  describe("duplicate Client email handling", () => {
    it("skips a row whose email already belongs to an existing Client in the same org — never updates, never fails the file", async () => {
      const suffix = randomUUID().slice(0, 8);
      const existing = await prisma.client.create({
        data: { name: `Existing-${suffix}`, email: `dup-${suffix}@example.com`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      createdClientIds.push(existing.id);

      const csv = `Name,Email\r\nNew-${suffix},dup-${suffix}@example.com\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      const mapping = [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "email" }];
      actAs(fixtures.owner, fixtures.orgA.id);
      const preview = await previewImportAction(uploadResult.importJobId, "CLIENT", mapping);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.skippedCount).toBe(1);
      expect(preview.rowDetails[0].message).toMatch(/duplicate/i);

      const exec = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.skippedCount).toBe(1);
      expect(exec.importedCount).toBe(0);

      // Never updated/merged — the existing Client is untouched.
      const stillExisting = await prisma.client.findUnique({ where: { id: existing.id } });
      expect(stillExisting?.name).toBe(`Existing-${suffix}`);
      // Never created a second Client with that email.
      const matching = await prisma.client.count({ where: { organizationId: fixtures.orgA.id, email: `dup-${suffix}@example.com` } });
      expect(matching).toBe(1);
    });

    it("skips the second of two rows in the same file that share one email", async () => {
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
      expect(exec.importedCount).toBe(1);
      expect(exec.skippedCount).toBe(1);

      const created = await prisma.client.findMany({ where: { organizationId: fixtures.orgA.id, email: `same-${suffix}@example.com` } });
      createdClientIds.push(...created.map((c) => c.id));
      expect(created).toHaveLength(1);
      expect(created[0].name).toBe(`First-${suffix}`);
    });

    it("a duplicate that arises between preview and execute is caught authoritatively at execute time too", async () => {
      const suffix = randomUUID().slice(0, 8);
      const csv = `Name,Email\r\nRace-${suffix},race-${suffix}@example.com\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      const mapping = [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "email" }];
      actAs(fixtures.owner, fixtures.orgA.id);
      const preview = await previewImportAction(uploadResult.importJobId, "CLIENT", mapping);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.validCount).toBe(1); // not yet a duplicate at preview time

      // Someone else creates a real Client with this exact email between
      // preview and confirm.
      const racer = await prisma.client.create({
        data: { name: `Racer-${suffix}`, email: `race-${suffix}@example.com`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      createdClientIds.push(racer.id);

      const exec = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(0);
      expect(exec.skippedCount).toBe(1);
    });

    it("a row with no email is never deduplicated by name or phone", async () => {
      const suffix = randomUUID().slice(0, 8);
      const csv = `Name\r\nSame-Name-${suffix}\r\nSame-Name-${suffix}\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, [{ columnIndex: 0, field: "name" }]);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(2); // both created — no name-based dedup
      expect(exec.skippedCount).toBe(0);

      const created = await prisma.client.findMany({ where: { organizationId: fixtures.orgA.id, name: `Same-Name-${suffix}` } });
      createdClientIds.push(...created.map((c) => c.id));
      expect(created).toHaveLength(2);
    });
  });

  describe("tenant isolation and replay security", () => {
    it("ImportJob is org-scoped — an actor in a different org cannot preview or execute it", async () => {
      const uploadResult = await upload(fixtures.owner, "Name\r\nAcme\r\n");
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.orgBOwner, fixtures.orgB.id);
      const preview = await previewImportAction(uploadResult.importJobId, "CLIENT", [{ columnIndex: 0, field: "name" }]);
      expect(preview.ok).toBe(false);
      if (preview.ok) return;
      expect(preview.reason).toBe("not_found");

      const exec = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(exec.ok).toBe(false);
      if (exec.ok) return;
      expect(exec.reason).toBe("not_found");
    });

    it("a forged/nonexistent job id is rejected the same way as a foreign-org one", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await executeImportAction(randomUUID(), "CLIENT");
      expect(exec.ok).toBe(false);
      if (exec.ok) return;
      expect(exec.reason).toBe("not_found");
    });

    it("a forged entity type (job is really CLIENT, claimed as LEAD) is rejected", async () => {
      const uploadResult = await upload(fixtures.owner, "Name\r\nAcme\r\n");
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await executeImportAction(uploadResult.importJobId, "LEAD");
      expect(exec.ok).toBe(false);
      if (exec.ok) return;
      expect(exec.reason).toBe("not_found");
    });

    it("replay: a second execute call on the same job is rejected, and no row is ever imported twice", async () => {
      const suffix = randomUUID().slice(0, 8);
      const uploadResult = await upload(fixtures.owner, `Name\r\nReplay-${suffix}\r\n`);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      await previewImportAction(uploadResult.importJobId, "CLIENT", [{ columnIndex: 0, field: "name" }]);

      const first = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.importedCount).toBe(1);

      const second = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe("already_processed");

      const created = await prisma.client.findMany({ where: { organizationId: fixtures.orgA.id, name: `Replay-${suffix}` } });
      createdClientIds.push(...created.map((c) => c.id));
      expect(created).toHaveLength(1); // never imported twice
    });

    it("a mapping targeting a non-existent field is rejected server-side even if somehow submitted", async () => {
      const uploadResult = await upload(fixtures.owner, "Name,Extra\r\nAcme,x\r\n");
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      const preview = await previewImportAction(uploadResult.importJobId, "CLIENT", [
        { columnIndex: 0, field: "name" },
        { columnIndex: 1, field: "statusDefinitionId" },
      ]);
      expect(preview.ok).toBe(false);
      if (preview.ok) return;
      expect(preview.reason).toBe("invalid_mapping");
    });

    it("a formula-injection-shaped Client name is stored as plain literal text, never evaluated", async () => {
      const suffix = randomUUID().slice(0, 8);
      const csv = `Name\r\n=SUM(A1:A2)-${suffix}\r\n`;
      const uploadResult = await upload(fixtures.owner, csv);
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      actAs(fixtures.owner, fixtures.orgA.id);
      const exec = await previewThenExecute(uploadResult.importJobId, [{ columnIndex: 0, field: "name" }]);
      expect(exec.ok).toBe(true);
      if (!exec.ok) return;
      expect(exec.importedCount).toBe(1);

      const created = await prisma.client.findFirstOrThrow({
        where: { organizationId: fixtures.orgA.id, name: { contains: suffix } },
      });
      createdClientIds.push(created.id);
      expect(created.name).toBe(`=SUM(A1:A2)-${suffix}`); // stored verbatim, never stripped/neutralized/evaluated
    });
  });
});
