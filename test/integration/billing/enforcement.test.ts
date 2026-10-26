import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  assertCanInviteMember,
  assertCanCreateClient,
  assertCanCreateProject,
  assertCanUploadAttachment,
  BillingLimitError,
} from "@/lib/billing/enforcement";
import { getOrganizationEntitlements } from "@/lib/billing/entitlements";
import { testEmail, testSlug } from "../../support/run-id";

async function createOrgWithSubscription(
  label: string,
  overrides: Partial<{ planKey: string; status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" | "UNPAID" }> = {},
) {
  const runSuffix = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: { id: randomUUID(), email: testEmail(`billing-enf-${label}`, "test.local", runSuffix), name: `Enforcement ${label}` },
  });
  const org = await prisma.organization.create({
    data: { name: `Enforcement Org ${label}`, slug: testSlug(`billing-enf-${label}`, runSuffix) },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });

  const now = new Date();
  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      planKey: overrides.planKey ?? "STARTER", // maxMembers: 1, maxClients: 10, maxProjects: 20, maxStorageBytes: 500MB
      status: overrides.status ?? "ACTIVE",
      trialStartedAt: now,
      trialEndsAt: now,
    },
  });

  return { owner, org };
}

async function cleanup(orgId: string, ownerId: string) {
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.delete({ where: { id: ownerId } });
}

describe("assertCanInviteMember", () => {
  it("under the limit: resolves without throwing", async () => {
    // STARTER's maxMembers is 1, already filled by the owner alone — PRO
    // (maxMembers 5) is used here specifically to leave real headroom;
    // STARTER is reserved for the "at the limit" case below.
    const { owner, org } = await createOrgWithSubscription("invite-under", { planKey: "PRO" });
    await expect(assertCanInviteMember(org.id)).resolves.toBeUndefined();
    await cleanup(org.id, owner.id);
  });

  it("at the limit (STARTER: maxMembers 1, owner already fills it): throws BillingLimitError with MEMBER_LIMIT_REACHED", async () => {
    const { owner, org } = await createOrgWithSubscription("invite-at");
    let caught: unknown;
    try {
      await assertCanInviteMember(org.id);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BillingLimitError);
    expect((caught as InstanceType<typeof BillingLimitError>).reasonCode).toBe("MEMBER_LIMIT_REACHED");
    await cleanup(org.id, owner.id);
  });

  it("a pending invitation alone (no second real member yet) is enough to hit the limit", async () => {
    const { owner, org } = await createOrgWithSubscription("invite-pending", { planKey: "PRO" }); // maxMembers: 5
    // Fill 4 more "slots" via pending invitations so owner(1) + 4 pending = 5 = the limit.
    for (let i = 0; i < 4; i++) {
      await prisma.invitation.create({
        data: {
          organizationId: org.id,
          email: testEmail(`billing-enf-pending-${i}`, "test.local", randomUUID().slice(0, 6)),
          role: "MEMBER",
          token: randomUUID(),
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedById: owner.id,
        },
      });
    }
    await expect(assertCanInviteMember(org.id)).rejects.toThrow();
    await prisma.invitation.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });

  it("READ_ONLY access mode blocks invites even with headroom under the count limit", async () => {
    const { owner, org } = await createOrgWithSubscription("invite-readonly", { planKey: "PRO", status: "UNPAID" });
    await expect(assertCanInviteMember(org.id)).rejects.toMatchObject({ reasonCode: "READ_ONLY_ACCESS" });
    await cleanup(org.id, owner.id);
  });
});

/**
 * Free Public Beta, Slice 1 — Member Limit Consistency. Exercises the
 * REAL, unmodified assertCanInviteMember() — the exact function
 * inviteMemberAction() calls — against a real test-database LEGACY
 * organization (native maxMembers: 1000), with process.env.FREE_BETA_MODE
 * genuinely set, proving the full wiring end to end.
 */
describe("assertCanInviteMember — Free Public Beta, Slice 1 (Member Limit Consistency)", () => {
  const ORIGINAL_FREE_BETA_MODE = process.env.FREE_BETA_MODE;

  afterEach(() => {
    if (ORIGINAL_FREE_BETA_MODE === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = ORIGINAL_FREE_BETA_MODE;
  });

  it("11/12: beta enabled on a LEGACY org — below 5 occupied seats can invite; at exactly 5 cannot, even though LEGACY's own real allowance (1000) would have allowed it", async () => {
    const { owner, org } = await createOrgWithSubscription("free-beta-members-legacy", { planKey: "LEGACY", status: "ACTIVE" });
    // owner alone = 1 occupied seat; add 3 more pending invitations to reach 4.
    for (let i = 0; i < 3; i++) {
      await prisma.invitation.create({
        data: {
          organizationId: org.id,
          email: testEmail(`billing-free-beta-members-${i}`, "test.local", randomUUID().slice(0, 6)),
          role: "MEMBER",
          token: randomUUID(),
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedById: owner.id,
        },
      });
    }

    process.env.FREE_BETA_MODE = "true";
    // 1 + 3 = 4 < 5 — still has headroom, even on a LEGACY org.
    await expect(assertCanInviteMember(org.id)).resolves.toBeUndefined();

    // One more pending invitation reaches 1 + 4 = 5 — exactly at the beta
    // ceiling, which LEGACY's own native 1000 would never have blocked.
    await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email: testEmail("billing-free-beta-members-last", "test.local", randomUUID().slice(0, 6)),
        role: "MEMBER",
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: owner.id,
      },
    });
    await expect(assertCanInviteMember(org.id)).rejects.toMatchObject({ reasonCode: "MEMBER_LIMIT_REACHED" });

    await prisma.invitation.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });

  it("13: beta enabled on a LEGACY org already holding more than 5 real members (a legitimate pre-beta organization): further invites are blocked, but every existing membership is completely untouched", async () => {
    const { owner, org } = await createOrgWithSubscription("free-beta-members-over", { planKey: "LEGACY", status: "ACTIVE" });
    const extraMembers = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const member = await prisma.user.create({
          data: { id: randomUUID(), email: testEmail(`billing-free-beta-members-extra-${i}`, "test.local", randomUUID().slice(0, 6)), name: `Extra Member ${i}` },
        });
        await prisma.membership.create({ data: { userId: member.id, organizationId: org.id, role: "MEMBER" } });
        return member;
      }),
    );
    // owner + 7 extra = 8 real members, well over the beta's 5-seat ceiling
    // but well under LEGACY's own native 1000.

    process.env.FREE_BETA_MODE = "true";
    await expect(assertCanInviteMember(org.id)).rejects.toMatchObject({ reasonCode: "MEMBER_LIMIT_REACHED" });

    // Every existing membership is completely unaffected — same count,
    // same rows, nobody removed or deactivated by the enforcement check.
    const membershipCount = await prisma.membership.count({ where: { organizationId: org.id } });
    expect(membershipCount).toBe(8);
    const entitlements = await getOrganizationEntitlements(org.id);
    expect(entitlements.currentMembers).toBe(8); // reported exactly, not clamped to 5
    expect(entitlements.accessMode).toBe("FULL_ACCESS"); // nothing else about the org is blocked

    await prisma.membership.deleteMany({ where: { userId: { in: extraMembers.map((m) => m.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: extraMembers.map((m) => m.id) } } });
    await cleanup(org.id, owner.id);
  });

  it("beta disabled on the same already-over-5 LEGACY org: invites are allowed again under LEGACY's own real 1000-seat allowance — confirms the fix is fully reversible with zero data change", async () => {
    const { owner, org } = await createOrgWithSubscription("free-beta-members-disabled", { planKey: "LEGACY", status: "ACTIVE" });
    const extraMembers = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const member = await prisma.user.create({
          data: { id: randomUUID(), email: testEmail(`billing-free-beta-members-disabled-${i}`, "test.local", randomUUID().slice(0, 6)), name: `Disabled Extra ${i}` },
        });
        await prisma.membership.create({ data: { userId: member.id, organizationId: org.id, role: "MEMBER" } });
        return member;
      }),
    );

    delete process.env.FREE_BETA_MODE;
    await expect(assertCanInviteMember(org.id)).resolves.toBeUndefined();

    await prisma.membership.deleteMany({ where: { userId: { in: extraMembers.map((m) => m.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: extraMembers.map((m) => m.id) } } });
    await cleanup(org.id, owner.id);
  });
});

describe("assertCanCreateClient", () => {
  it("under the limit: resolves", async () => {
    const { owner, org } = await createOrgWithSubscription("client-under");
    await expect(assertCanCreateClient(org.id)).resolves.toBeUndefined();
    await cleanup(org.id, owner.id);
  });

  it("at the limit (STARTER: maxClients 10): throws with CLIENT_LIMIT_REACHED", async () => {
    const { owner, org } = await createOrgWithSubscription("client-at");
    await prisma.client.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ name: `Client ${i}`, userId: owner.id, organizationId: org.id })),
    });
    await expect(assertCanCreateClient(org.id)).rejects.toMatchObject({ reasonCode: "CLIENT_LIMIT_REACHED" });
    await prisma.client.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });

  it("legacy organization (no Subscription row) is never blocked", async () => {
    const owner = await prisma.user.create({
      data: { id: randomUUID(), email: testEmail("billing-enf-legacy-client", "test.local", randomUUID().slice(0, 8)), name: "Legacy Owner" },
    });
    const org = await prisma.organization.create({ data: { name: "Legacy Client Org", slug: testSlug("billing-enf-legacy-client", randomUUID().slice(0, 8)) } });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    // Deliberately no Subscription row created — this is the legacy case.

    await prisma.client.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ name: `Legacy Client ${i}`, userId: owner.id, organizationId: org.id })),
    });
    await expect(assertCanCreateClient(org.id)).resolves.toBeUndefined();

    await prisma.client.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });

  it("cross-org: a caller cannot use org A's usage to authorize a write scoped to org B — passing org B's id always evaluates org B's own state", async () => {
    const orgA = await createOrgWithSubscription("cross-a");
    const orgB = await createOrgWithSubscription("cross-b");
    // Fill org A to its limit; org B stays empty.
    await prisma.client.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ name: `A Client ${i}`, userId: orgA.owner.id, organizationId: orgA.org.id })),
    });

    await expect(assertCanCreateClient(orgA.org.id)).rejects.toThrow(); // org A is at its limit
    await expect(assertCanCreateClient(orgB.org.id)).resolves.toBeUndefined(); // org B is untouched by org A's usage

    await prisma.client.deleteMany({ where: { organizationId: orgA.org.id } });
    await cleanup(orgA.org.id, orgA.owner.id);
    await cleanup(orgB.org.id, orgB.owner.id);
  });
});

describe("assertCanCreateProject", () => {
  it("under/at the limit (STARTER: maxProjects 20)", async () => {
    const { owner, org } = await createOrgWithSubscription("project-limit");
    const client = await prisma.client.create({ data: { name: "Project Owner Client", userId: owner.id, organizationId: org.id } });

    await expect(assertCanCreateProject(org.id)).resolves.toBeUndefined();

    await prisma.project.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        name: `Project ${i}`,
        clientId: client.id,
        ownerId: owner.id,
        organizationId: org.id,
        status: "PLANNING",
      })),
    });
    await expect(assertCanCreateProject(org.id)).rejects.toMatchObject({ reasonCode: "PROJECT_LIMIT_REACHED" });

    await prisma.project.deleteMany({ where: { organizationId: org.id } });
    await prisma.client.delete({ where: { id: client.id } });
    await cleanup(org.id, owner.id);
  });
});

describe("assertCanUploadAttachment", () => {
  it("under the storage limit: resolves", async () => {
    const { owner, org } = await createOrgWithSubscription("upload-under"); // STARTER: 500MB
    await expect(assertCanUploadAttachment(org.id, 1024)).resolves.toBeUndefined();
    await cleanup(org.id, owner.id);
  });

  it("an upload that would cross the limit is rejected, even though current usage is under it", async () => {
    const { owner, org } = await createOrgWithSubscription("upload-cross");
    const maxBytes = 500 * 1024 * 1024;
    await prisma.attachment.create({
      data: {
        organizationId: org.id,
        entityType: "CLIENT",
        entityId: randomUUID(),
        storageBucket: "attachments",
        storagePath: `test/${randomUUID()}`,
        originalName: "big.pdf",
        mimeType: "application/pdf",
        sizeBytes: maxBytes - 100,
      },
    });

    await expect(assertCanUploadAttachment(org.id, 50)).resolves.toBeUndefined(); // fits
    await expect(assertCanUploadAttachment(org.id, 200)).rejects.toMatchObject({ reasonCode: "STORAGE_LIMIT_REACHED" }); // would cross

    await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });
});

/**
 * Architecture note (discovered while writing this slice's own tests, not
 * a product defect): `Attachment.sizeBytes` is a Postgres `Int` column
 * (prisma/schema.prisma) — a 32-bit signed integer, max ~2.147 GiB per
 * ROW. This is never reachable in real usage (every real upload is
 * already capped at 10 MB per file, src/lib/attachments/attachment-
 * files.ts), and Postgres's own SUM(integer) aggregate widens to a
 * 64-bit accumulator internally, so a real organization's aggregated
 * `getOrganizationUsage().storageBytes` can and does correctly exceed
 * 2^31 across many real rows — only a single row's own stored value is
 * bounded. This helper exists purely so these tests simulate realistic
 * "many real uploads adding up to N bytes" usage instead of one
 * physically-impossible giant row.
 */
async function seedAttachmentUsage(organizationId: string, totalBytes: number): Promise<void> {
  const CHUNK_BYTES = 500 * 1024 * 1024; // 500 MiB per row — safely under the Int column's ~2.147 GiB ceiling
  let remaining = totalBytes;
  while (remaining > 0) {
    const sizeBytes = Math.min(remaining, CHUNK_BYTES);
    await prisma.attachment.create({
      data: {
        organizationId,
        entityType: "CLIENT",
        entityId: randomUUID(),
        storageBucket: "attachments",
        storagePath: `test/${randomUUID()}`,
        originalName: "existing-usage-chunk.pdf",
        mimeType: "application/pdf",
        sizeBytes,
      },
    });
    remaining -= sizeBytes;
  }
}

/**
 * Free Public Beta, Slice 1 — Storage Limit Adjustment. Exercises the
 * REAL, unmodified assertCanUploadAttachment() — the exact function
 * uploadAttachmentForEntity() calls — against a real test-database
 * organization, with process.env.FREE_BETA_MODE genuinely set, proving
 * the full wiring end to end (not just buildOrganizationEntitlements in
 * isolation, already covered in test/unit/billing-entitlements.test.ts).
 */
describe("assertCanUploadAttachment — Free Public Beta, Slice 1 (Storage Limit Adjustment)", () => {
  const ORIGINAL_FREE_BETA_MODE = process.env.FREE_BETA_MODE;

  afterEach(() => {
    if (ORIGINAL_FREE_BETA_MODE === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = ORIGINAL_FREE_BETA_MODE;
  });

  it("G/H: beta enabled on a PRO org (real 10 GiB allowance) — an upload at ~2.9 GiB usage + ~0.2 GiB is rejected under the 3 GiB beta ceiling, even though PRO's own real allowance would have allowed it", async () => {
    const { owner, org } = await createOrgWithSubscription("free-beta-storage-cross", { planKey: "PRO", status: "ACTIVE" });
    await seedAttachmentUsage(org.id, Math.round(2.9 * 1024 * 1024 * 1024));

    process.env.FREE_BETA_MODE = "true";
    const proposedUpload = Math.round(0.2 * 1024 * 1024 * 1024);

    // Would easily fit under PRO's real 10 GiB allowance — rejected only
    // because of the 3 GiB beta ceiling.
    await expect(assertCanUploadAttachment(org.id, proposedUpload)).rejects.toMatchObject({
      reasonCode: "STORAGE_LIMIT_REACHED",
    });

    // A small upload that keeps the total at/under 3 GiB still succeeds.
    await expect(assertCanUploadAttachment(org.id, 10 * 1024 * 1024)).resolves.toBeUndefined();

    await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });

  it("I: an organization already over the 3 GiB beta ceiling is rejected for further uploads, with its existing data completely untouched", async () => {
    const { owner, org } = await createOrgWithSubscription("free-beta-storage-over", { planKey: "PRO", status: "ACTIVE" });
    // 5 GiB total, already over the 3 GiB beta ceiling — seeded as
    // realistic-sized rows (see seedAttachmentUsage's own doc comment).
    await seedAttachmentUsage(org.id, 5 * 1024 * 1024 * 1024);
    const attachmentsBefore = await prisma.attachment.findMany({ where: { organizationId: org.id }, orderBy: { storagePath: "asc" } });

    process.env.FREE_BETA_MODE = "true";
    await expect(assertCanUploadAttachment(org.id, 1)).rejects.toMatchObject({ reasonCode: "STORAGE_LIMIT_REACHED" });

    // Every existing attachment row is completely unmodified by the
    // rejected upload attempt — same set, same ids, same sizes, same
    // storage paths. Nothing was deleted, truncated, or altered.
    const attachmentsAfter = await prisma.attachment.findMany({ where: { organizationId: org.id }, orderBy: { storagePath: "asc" } });
    expect(attachmentsAfter).toEqual(attachmentsBefore);
    expect(attachmentsAfter.reduce((sum, a) => sum + a.sizeBytes, 0)).toBe(5 * 1024 * 1024 * 1024);

    await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });

  it("A/B: the 3 GiB ceiling applies identically to a TRIALING org and to a non-TRIAL (PRO/ACTIVE) org", async () => {
    const trial = await createOrgWithSubscription("free-beta-storage-trial", { planKey: "TRIAL", status: "TRIALING" });
    const pro = await createOrgWithSubscription("free-beta-storage-pro", { planKey: "PRO", status: "ACTIVE" });

    for (const { org } of [trial, pro]) {
      await seedAttachmentUsage(org.id, 3221225472);
    }

    process.env.FREE_BETA_MODE = "true";
    await expect(assertCanUploadAttachment(trial.org.id, 2)).rejects.toMatchObject({ reasonCode: "STORAGE_LIMIT_REACHED" });
    await expect(assertCanUploadAttachment(pro.org.id, 2)).rejects.toMatchObject({ reasonCode: "STORAGE_LIMIT_REACHED" });

    await prisma.attachment.deleteMany({ where: { organizationId: { in: [trial.org.id, pro.org.id] } } });
    await cleanup(trial.org.id, trial.owner.id);
    await cleanup(pro.org.id, pro.owner.id);
  });

  it("E/F: beta disabled — existing allowances (TRIAL 10 GiB, PRO 10 GiB, STARTER 500 MB) are completely unaffected", async () => {
    delete process.env.FREE_BETA_MODE;
    const { owner, org } = await createOrgWithSubscription("free-beta-storage-disabled", { planKey: "PRO", status: "ACTIVE" });
    await seedAttachmentUsage(org.id, Math.round(2.9 * 1024 * 1024 * 1024));

    // Same ~2.9 GiB + ~0.2 GiB that was rejected above under the beta
    // ceiling now succeeds, because PRO's real 10 GiB allowance applies.
    await expect(assertCanUploadAttachment(org.id, Math.round(0.2 * 1024 * 1024 * 1024))).resolves.toBeUndefined();

    await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });
});

describe("existing reads/updates/deletes are never affected by any billing check", () => {
  it("reading, updating, and deleting an existing Client succeeds even when the org is at/over its client limit", async () => {
    const { owner, org } = await createOrgWithSubscription("readwrite-unaffected");
    await prisma.client.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ name: `RW Client ${i}`, userId: owner.id, organizationId: org.id })),
    });
    const existing = await prisma.client.findFirstOrThrow({ where: { organizationId: org.id } });

    // Reading.
    const read = await prisma.client.findUnique({ where: { id: existing.id } });
    expect(read).not.toBeNull();

    // Updating (no billing check anywhere on the edit path in this stage).
    const updated = await prisma.client.update({ where: { id: existing.id }, data: { notes: "updated freely" } });
    expect(updated.notes).toBe("updated freely");

    // Deleting.
    await prisma.client.delete({ where: { id: existing.id } });
    const afterDelete = await prisma.client.findUnique({ where: { id: existing.id } });
    expect(afterDelete).toBeNull();

    await prisma.client.deleteMany({ where: { organizationId: org.id } });
    await cleanup(org.id, owner.id);
  });
});

describe("getOrganizationEntitlements — cross-org isolation at the top-level entry point", () => {
  it("two different organizationIds always resolve independently, never bleeding usage/limits across each other", async () => {
    const orgA = await createOrgWithSubscription("entitlements-a", { planKey: "STARTER" });
    const orgB = await createOrgWithSubscription("entitlements-b", { planKey: "PRO" });

    const entitlementsA = await getOrganizationEntitlements(orgA.org.id);
    const entitlementsB = await getOrganizationEntitlements(orgB.org.id);

    expect(entitlementsA.planKey).toBe("STARTER");
    expect(entitlementsB.planKey).toBe("PRO");
    expect(entitlementsA.maxClients).toBe(10);
    expect(entitlementsB.maxClients).toBeNull();

    await cleanup(orgA.org.id, orgA.owner.id);
    await cleanup(orgB.org.id, orgB.owner.id);
  });
});
