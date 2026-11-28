import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { convertLeadToClientAction } from "@/app/(dashboard)/leads/actions";
import { uploadImportFileAction, previewImportAction, executeImportAction } from "@/lib/import/server-actions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { PLAN_CATALOG } from "@/lib/billing/plans";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { testEmail, testSlug } from "../../support/run-id";

/**
 * Aqenra Free plan — proves the 25-client limit cannot be bypassed via
 * lead conversion or CSV import, the two write paths that do NOT go
 * through the interactive createClientAction form (already covered
 * generically, at STARTER's own numbers, by test/integration/billing/
 * enforcement.test.ts's assertCanCreateClient coverage and
 * test/integration/clients/create.test.ts). Both paths already route
 * through the exact same createClientCore/assertCanCreateClient chokepoint
 * as interactive creation (src/app/(dashboard)/leads/actions.ts's own
 * convertLeadToClientAction, src/lib/import/server-actions.ts's execute
 * step) — this file proves that holds at the Free plan's own real
 * 25-client ceiling, not just in theory.
 */

const MAX_FREE_CLIENTS = PLAN_CATALOG.FREE.limits.maxClients!;

async function createFreePlanOrgAtClientLimit(label: string) {
  const runSuffix = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: { id: randomUUID(), email: testEmail(`free-plan-client-${label}`, "test.local", runSuffix), name: `Free Plan Client ${label}` },
  });
  const org = await prisma.organization.create({
    data: { name: `Free Plan Client Org ${label}`, slug: testSlug(`free-plan-client-${label}`, runSuffix) },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  const now = new Date();
  await prisma.subscription.create({
    data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
  });
  await bootstrapOrganizationStatusDefinitions(prisma, org.id);

  await prisma.client.createMany({
    data: Array.from({ length: MAX_FREE_CLIENTS }, (_, i) => ({
      name: `Existing Client ${i}`,
      userId: owner.id,
      organizationId: org.id,
    })),
  });

  return { owner, org };
}

async function cleanupOrg(orgId: string, ownerId: string) {
  await prisma.clientContact.deleteMany({ where: { client: { organizationId: orgId } } });
  await prisma.lead.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.delete({ where: { id: ownerId } });
}

afterEach(resetAuthMock);

describe("Aqenra Free plan — 25-client limit cannot be bypassed", () => {
  it("lead conversion is rejected at exactly 25 existing clients, and no 26th Client is created", async () => {
    const { owner, org } = await createFreePlanOrgAtClientLimit(`lead-${randomUUID().slice(0, 8)}`);
    try {
      const lead = await prisma.lead.create({
        data: { name: "Ready To Convert", email: testEmail("lead-convert", "test.local"), organizationId: org.id },
      });

      actAs(owner, org.id);
      const result = await convertLeadToClientAction(lead.id);

      expect(result).toEqual({
        ok: false,
        reason: "entitlement_blocked",
        message: "Your plan's client limit has been reached.",
      });

      const clientCount = await prisma.client.count({ where: { organizationId: org.id } });
      expect(clientCount).toBe(MAX_FREE_CLIENTS);
      const unconverted = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(unconverted.convertedClientId).toBeNull();
    } finally {
      await cleanupOrg(org.id, owner.id);
    }
  });

  it("CSV import stops importing new clients at exactly 25, reporting the remaining rows as failed — not silently truncated or exceeded", async () => {
    const { owner, org } = await createFreePlanOrgAtClientLimit(`csv-${randomUUID().slice(0, 8)}`);
    try {
      actAs(owner, org.id);
      const suffix = randomUUID().slice(0, 8);
      const csv = `Name\r\nImported-A-${suffix}\r\nImported-B-${suffix}\r\nImported-C-${suffix}\r\n`;

      const uploadResult = await uploadImportFileAction("CLIENT", (() => {
        const fd = new FormData();
        fd.set("file", new File([csv], "clients.csv", { type: "text/csv" }));
        return fd;
      })());
      expect(uploadResult.ok).toBe(true);
      if (!uploadResult.ok) return;

      const preview = await previewImportAction(uploadResult.importJobId, "CLIENT", [{ columnIndex: 0, field: "name" }]);
      expect(preview.ok).toBe(true);

      const execution = await executeImportAction(uploadResult.importJobId, "CLIENT");
      expect(execution.ok).toBe(true);
      if (!execution.ok) return;

      // All 3 rows rejected — the org was already at the 25-client
      // ceiling before the import even started, so none of them fit.
      expect(execution.importedCount).toBe(0);
      expect(execution.failedCount).toBe(3);

      const clientCount = await prisma.client.count({ where: { organizationId: org.id } });
      expect(clientCount).toBe(MAX_FREE_CLIENTS);

      await prisma.importJob.delete({ where: { id: uploadResult.importJobId } });
    } finally {
      await cleanupOrg(org.id, owner.id);
    }
  });
});
