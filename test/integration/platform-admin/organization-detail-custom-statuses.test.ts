import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrganizationDetail } from "@/lib/platform-admin/queries/organization-detail";
import { createCustomStatusDefinition } from "@/lib/custom-statuses/definitions";
import { assignClientStatus, assignProjectStatus } from "@/lib/custom-statuses/assignment";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";

/**
 * Custom Statuses Phase 2A Completion Pass (Section C) — test items
 * 9-12 of the originating task's own Section E. Proves the Platform
 * Admin organization-detail Client/Project preview now presents status
 * via resolveStatusPresentation() (the same authoritative adapter the
 * tenant-facing list pages use), not the raw legacy enum — including a
 * genuinely custom status with a stale legacy value.
 *
 * requirePlatformAdmin()'s own execution-order guard is already fully
 * proven elsewhere (execution-authorization.test.ts) and is not
 * re-proven here — this file is content-correctness only, mirroring
 * organization-detail-onboarding.test.ts's own exact scoping note.
 */

const PLATFORM_ADMIN_TEST_EMAIL = "platform-admin-custom-statuses-test@example.com";
const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

beforeAll(() => {
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_TEST_EMAIL;
});

afterAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
  // Client.organizationId is onDelete: SetNull, so Client rows must be
  // deleted explicitly before the Organization (which would otherwise
  // strand them, still referencing their owning User via onDelete:
  // Restrict) — same ordering organization-detail-onboarding.test.ts's
  // own cleanup already establishes.
  await prisma.client.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

afterEach(() => {
  resetAuthMock();
});

function asPlatformAdmin() {
  setMockAuthUser({ id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL });
}

async function createBootstrappedOrg(name: string) {
  const org = await prisma.organization.create({ data: { name, slug: `custom-status-admin-test-${randomUUID()}` } });
  createdOrgIds.push(org.id);
  await bootstrapOrganizationStatusDefinitions(prisma, org.id);
  return org;
}

async function createOwnerUser() {
  const user = await prisma.user.create({
    data: { id: randomUUID(), name: "Admin Preview Owner", email: `admin-preview-owner-${randomUUID()}@example.test` },
  });
  createdUserIds.push(user.id);
  return user;
}

describe("getOrganizationDetail — Custom Statuses Phase 2A Completion Pass (Client/Project preview presentation)", () => {
  it("9. a Client's custom status label is displayed instead of its stale legacy label", async () => {
    const org = await createBootstrappedOrg("Custom Client Status Org");
    const owner = await createOwnerUser();
    const customDef = await createCustomStatusDefinition(org.id, "CLIENT", { label: "VIP Priority" });
    if (!customDef.ok) throw new Error("expected ok");
    const client = await prisma.client.create({
      data: { name: "Admin Preview Client", status: "ACTIVE", organizationId: org.id, userId: owner.id },
    });
    await assignClientStatus(org.id, client.id, customDef.definition.id);

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());
    const preview = detail!.clients.preview.find((c) => c.id === client.id)!;
    expect(preview.statusDefinition?.label).toBe("VIP Priority");
    // The raw legacy value is still returned (stale "ACTIVE") — the page
    // itself is the one place it gets resolved via
    // resolveStatusPresentation(), proven separately below.
    expect(preview.status).toBe("ACTIVE");
  });

  it("10. a Project's custom status label is displayed instead of its stale legacy label", async () => {
    const org = await createBootstrappedOrg("Custom Project Status Org");
    const owner = await createOwnerUser();
    const client = await prisma.client.create({ data: { name: "Project Owner Client", organizationId: org.id, userId: owner.id } });
    const customDef = await createCustomStatusDefinition(org.id, "PROJECT", { label: "Awaiting Client" });
    if (!customDef.ok) throw new Error("expected ok");
    const project = await prisma.project.create({
      data: { name: "Admin Preview Project", status: "IN_PROGRESS", clientId: client.id, ownerId: owner.id, organizationId: org.id },
    });
    await assignProjectStatus(org.id, project.id, customDef.definition.id);

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());
    const preview = detail!.projects.preview.find((p) => p.id === project.id)!;
    expect(preview.statusDefinition?.label).toBe("Awaiting Client");
    expect(preview.status).toBe("IN_PROGRESS");
  });

  it("11. the resolved presentation (via resolveStatusPresentation) uses the definition's own color, not the legacy value's tone", async () => {
    const { resolveStatusPresentation } = await import("@/lib/custom-statuses/presentation");
    const org = await createBootstrappedOrg("Color Tone Org");
    const owner = await createOwnerUser();
    const customDef = await createCustomStatusDefinition(org.id, "CLIENT", { label: "Escalated", color: "DANGER" });
    if (!customDef.ok) throw new Error("expected ok");
    const client = await prisma.client.create({
      data: { name: "Tone Test Client", status: "LEAD", organizationId: org.id, userId: owner.id },
    });
    await assignClientStatus(org.id, client.id, customDef.definition.id);

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());
    const preview = detail!.clients.preview.find((c) => c.id === client.id)!;
    const presentation = resolveStatusPresentation(preview.statusDefinition, preview.status);
    expect(presentation).toEqual({ label: "Escalated", tone: "danger" });
    // Not the legacy LEAD value's own "neutral" tone.
    expect(presentation.tone).not.toBe("neutral");
  });

  it("12. a null-statusDefinition legacy fixture still renders via the fallback", async () => {
    const { resolveStatusPresentation } = await import("@/lib/custom-statuses/presentation");
    const org = await createBootstrappedOrg("Null Fallback Org");
    const owner = await createOwnerUser();
    // Raw create, statusDefinitionId left null on purpose.
    const client = await prisma.client.create({
      data: { name: "Unbackfilled Preview Client", status: "INACTIVE", organizationId: org.id, userId: owner.id },
    });

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());
    const preview = detail!.clients.preview.find((c) => c.id === client.id)!;
    expect(preview.statusDefinition).toBeNull();
    const presentation = resolveStatusPresentation(preview.statusDefinition, preview.status);
    expect(presentation).toEqual({ label: "Inactive", tone: "muted" });
  });
});
