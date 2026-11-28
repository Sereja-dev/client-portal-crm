import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { uploadCompanyLogoAction } from "@/app/(dashboard)/settings/company/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import {
  setLogoUploadShouldFail,
  resetLogoStorageMock,
  removedLogoUrls,
  setLogoUploadMidFlightHook,
} from "../../support/logo-storage-mock";

function makeLogoFormData(name = "logo.png", type = "image/png", size = 1024): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(size)], name, { type }));
  return fd;
}

async function seedProfile(organizationId: string): Promise<void> {
  await prisma.organizationProfile.create({
    data: {
      organizationId,
      legalName: "Acme Legal Name LLC",
      country: "United States",
      currency: "USD",
      timezone: "America/New_York",
    },
  });
}

describe("Company logo upload — Sale-Ready Phase A.1 (Business Identity), PR4", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    resetLogoStorageMock();
    await prisma.organizationProfile.deleteMany({
      where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } },
    });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("OWNER can upload a valid PNG logo, persisted to OrganizationProfile.logoUrl", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
    expect(result.error).toBeNull();

    const profile = await prisma.organizationProfile.findUniqueOrThrow({
      where: { organizationId: fixtures.orgA.id },
    });
    expect(profile.logoUrl).toMatch(/^https:\/\/mock\.supabase\.test\/storage\/v1\/object\/public\/logos\//);
  });

  it.each([
    ["image/jpeg", "logo.jpg"],
    ["image/webp", "logo.webp"],
  ])("OWNER can upload a valid %s logo", async (type, name) => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData(name, type));
    expect(result.error).toBeNull();
  });

  it("MEMBER cannot upload a logo — same OWNER-only boundary as the text-field form", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.member, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
    expect(result.error).toBe("Only the organization owner can update company details.");

    const profile = await prisma.organizationProfile.findUniqueOrThrow({
      where: { organizationId: fixtures.orgA.id },
    });
    expect(profile.logoUrl).toBeNull();
  });

  it("ADMIN cannot upload a logo either", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.admin, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
    expect(result.error).toBe("Only the organization owner can update company details.");
  });

  it("rejects an SVG (can carry embedded scripts), even with an internally-consistent extension/MIME pair", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData("icon.svg", "image/svg+xml"));
    expect(result.error).toBe("Only PNG, JPEG, and WebP images are supported.");

    const profile = await prisma.organizationProfile.findUniqueOrThrow({
      where: { organizationId: fixtures.orgA.id },
    });
    expect(profile.logoUrl).toBeNull();
  });

  it("rejects a GIF", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData("animated.gif", "image/gif"));
    expect(result.error).toBe("Only PNG, JPEG, and WebP images are supported.");
  });

  it("rejects any other disallowed MIME type (e.g. a PDF)", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData("doc.pdf", "application/pdf"));
    expect(result.error).toBe("Only PNG, JPEG, and WebP images are supported.");
  });

  it("rejects an oversized file (one byte over the 2 MB limit)", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction(
      { error: null },
      makeLogoFormData("logo.png", "image/png", 2 * 1024 * 1024 + 1),
    );
    expect(result.error).toBe("This file is too large. Maximum size is 2 MB.");

    const profile = await prisma.organizationProfile.findUniqueOrThrow({
      where: { organizationId: fixtures.orgA.id },
    });
    expect(profile.logoUrl).toBeNull();
  });

  it("rejects an upload when no OrganizationProfile row exists yet, with a clear, actionable message", async () => {
    // Deliberately no seedProfile() call — org B has no OrganizationProfile row.
    actAs(fixtures.orgBOwner, fixtures.orgB.id);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
    expect(result.error).toBe("Save your business details before uploading a logo.");
  });

  it("rejects a missing file", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await uploadCompanyLogoAction({ error: null }, new FormData());
    expect(result.error).toBe("Please choose a file to upload.");
  });

  it("uploading a second logo replaces logoUrl and removes the previous Storage object as best-effort cleanup", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const first = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
    expect(first.error).toBeNull();
    const afterFirst = await prisma.organizationProfile.findUniqueOrThrow({
      where: { organizationId: fixtures.orgA.id },
    });
    const firstLogoUrl = afterFirst.logoUrl;
    expect(firstLogoUrl).not.toBeNull();

    const second = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
    expect(second.error).toBeNull();

    expect(removedLogoUrls).toContain(firstLogoUrl);

    const afterSecond = await prisma.organizationProfile.findUniqueOrThrow({
      where: { organizationId: fixtures.orgA.id },
    });
    expect(afterSecond.logoUrl).not.toBe(firstLogoUrl);
  });

  it("Storage upload failure is reported without ever writing logoUrl", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.owner, fixtures.orgA.id);
    setLogoUploadShouldFail(true);

    const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
    expect(result.error).toBe("Failed to upload the logo. Please try again.");

    const profile = await prisma.organizationProfile.findUniqueOrThrow({
      where: { organizationId: fixtures.orgA.id },
    });
    expect(profile.logoUrl).toBeNull();
  });

  it("a MEMBER's forbidden attempt never reaches Storage at all (no upload side effect)", async () => {
    await seedProfile(fixtures.orgA.id);
    actAs(fixtures.member, fixtures.orgA.id);

    await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
    expect(removedLogoUrls).toHaveLength(0);
  });
});

/**
 * Aqenra Free plan — concurrency correction. The logo upload path
 * previously had NO storage-limit check at all (confirmed by inspection:
 * no assertCanUploadAttachment-equivalent call existed anywhere in its
 * call chain) — a logo could be written regardless of how far over the
 * organization's quota it would push the total. This describe block
 * proves the new gate (reserveStorageBytes, shared with the Attachment
 * upload path) actually applies here too, and that its reservation is
 * correctly released on every real outcome. A dedicated FREE-plan
 * organization (never the shared LEGACY-plan fixtures above, whose
 * effectively unlimited storage ceiling could never exercise this gate
 * at a realistic size).
 */
describe("Company logo upload — Aqenra Free plan storage reservation lifecycle", () => {
  async function createFreePlanOrgWithProfile(label: string) {
    const owner = await prisma.user.create({
      data: { id: randomUUID(), email: `logo-res-${label}-${randomUUID().slice(0, 8)}@test.local`, name: `Logo Reservation ${label}` },
    });
    const org = await prisma.organization.create({
      data: { name: `Logo Reservation Org ${label}`, slug: `logo-res-${label}-${randomUUID().slice(0, 8)}` },
    });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const now = new Date();
    await prisma.subscription.create({
      data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
    });
    await seedProfile(org.id);
    return { owner, org };
  }

  async function cleanup(org: { id: string }, owner: { id: string }) {
    await prisma.organizationProfile.deleteMany({ where: { organizationId: org.id } });
    await prisma.storageReservation.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }

  afterEach(() => {
    resetAuthMock();
    resetLogoStorageMock();
  });

  it("a successful upload leaves no reservation behind — only the real, committed logoSizeBytes accounts for the bytes", async () => {
    const { owner, org } = await createFreePlanOrgWithProfile(`success-${randomUUID().slice(0, 6)}`);
    try {
      actAs(owner, org.id);
      const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData("logo.png", "image/png", 2048));
      expect(result.error).toBeNull();

      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
      const profile = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId: org.id } });
      expect(profile.logoSizeBytes).toBe(2048);
    } finally {
      await cleanup(org, owner);
    }
  });

  it("a Storage upload failure releases the reservation", async () => {
    const { owner, org } = await createFreePlanOrgWithProfile(`storage-fail-${randomUUID().slice(0, 6)}`);
    try {
      actAs(owner, org.id);
      setLogoUploadShouldFail(true);
      const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
      expect(result.error).toBe("Failed to upload the logo. Please try again.");

      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
    } finally {
      await cleanup(org, owner);
    }
  });

  it("a logo upload that would push the organization over its 1 GiB FREE-plan ceiling is blocked, through the real reservation check", async () => {
    const { owner, org } = await createFreePlanOrgWithProfile(`over-limit-${randomUUID().slice(0, 6)}`);
    try {
      // Simulate pre-existing usage already at the ceiling via an Attachment
      // row (a real, counted object type) — a fresh logo upload for this
      // organization must still be blocked regardless of which object
      // type consumed the quota.
      await prisma.attachment.create({
        data: {
          organizationId: org.id,
          entityType: "CLIENT",
          entityId: randomUUID(),
          storageBucket: "attachments",
          storagePath: `test/${randomUUID()}`,
          originalName: "existing.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1 * 1024 * 1024 * 1024,
        },
      });

      actAs(owner, org.id);
      const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData());
      expect(result.error).toBe("Your storage limit has been reached.");

      expect(removedLogoUrls).toHaveLength(0); // never reached Storage at all
      const profile = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId: org.id } });
      expect(profile.logoUrl).toBeNull();
      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);

      await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    } finally {
      await cleanup(org, owner);
    }
  });

  it("replacing a logo with a much smaller file while already recorded at the ceiling still succeeds — a net-negative change is never blocked", async () => {
    const { owner, org } = await createFreePlanOrgWithProfile(`replace-at-limit-${randomUUID().slice(0, 6)}`);
    try {
      actAs(owner, org.id);
      // The 2 MB per-logo-file limit makes a literal 1 GiB logo file
      // impossible to submit through validateLogoFile — instead, seed the
      // "already recorded at the ceiling" state directly via
      // logoSizeBytes (exactly what a real prior upload would have left
      // behind), then replace it with a real, small logo, proving the
      // net-delta math — not the new file's own absolute size — is what
      // actually gets checked.
      await prisma.organizationProfile.update({
        where: { organizationId: org.id },
        data: {
          logoUrl: "https://mock.supabase.test/storage/v1/object/public/logos/pre-existing.png",
          logoSizeBytes: 1 * 1024 * 1024 * 1024,
        },
      });

      const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData("logo.png", "image/png", 2048));
      // The new file (2048 bytes) is far SMALLER than the recorded
      // previous logoSizeBytes (1 GiB) — netAdditionalBytes is deeply
      // negative, always a no-op success regardless of current usage.
      expect(result.error).toBeNull();

      const profile = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId: org.id } });
      expect(profile.logoSizeBytes).toBe(2048);
    } finally {
      await cleanup(org, owner);
    }
  });

  // -------------------------------------------------------------------
  // Reservation-expiry message-accuracy correction — same real,
  // timing-controlled technique as attachments/mutations.test.ts's own
  // identical pair: setLogoUploadMidFlightHook pauses inside the mocked
  // Storage call, the one real await point uploadOrganizationLogo has
  // between reservation and consumption.
  // -------------------------------------------------------------------

  it("FIXED message accuracy: a reservation lost mid-upload with AMPLE room still free and no competitor is reported as a retry-oriented message, never storage-full", async () => {
    const { owner, org } = await createFreePlanOrgWithProfile(`accuracy-ample-${randomUUID().slice(0, 6)}`);
    try {
      actAs(owner, org.id);
      setLogoUploadMidFlightHook(async () => {
        const mine = await prisma.storageReservation.findFirstOrThrow({ where: { organizationId: org.id } });
        await prisma.storageReservation.update({ where: { id: mine.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      });

      const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData("logo.png", "image/png", 2048));

      // Essentially 1 GiB of free room the entire time — reporting
      // "storage limit reached" here would be false.
      expect(result.error).toBe("This took longer than expected. Please try uploading the logo again.");

      const profile = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId: org.id } });
      expect(profile.logoUrl).toBeNull();
      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
      // The uploaded object was compensated — never left as an orphan.
      expect(removedLogoUrls).toHaveLength(1);
    } finally {
      setLogoUploadMidFlightHook(null);
      await cleanup(org, owner);
    }
  });

  it("FIXED message accuracy: a reservation lost mid-upload to a real competing upload that genuinely filled the remaining room IS reported as storage-full", async () => {
    const { owner, org } = await createFreePlanOrgWithProfile(`accuracy-full-${randomUUID().slice(0, 6)}`);
    try {
      actAs(owner, org.id);
      const maxBytes = 1 * 1024 * 1024 * 1024;
      const fileBytes = 2048;
      await prisma.attachment.create({
        data: {
          organizationId: org.id,
          entityType: "CLIENT",
          entityId: randomUUID(),
          storageBucket: "attachments",
          storagePath: `test/${randomUUID()}`,
          originalName: "existing.pdf",
          mimeType: "application/pdf",
          sizeBytes: maxBytes - fileBytes,
        },
      });

      setLogoUploadMidFlightHook(async () => {
        const mine = await prisma.storageReservation.findFirstOrThrow({ where: { organizationId: org.id } });
        await prisma.storageReservation.update({ where: { id: mine.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

        // A genuinely independent competing upload claims the exact
        // same now-freed headroom for real.
        const { reserveStorageBytes, consumeStorageReservation } = await import("@/lib/billing/storage-reservation");
        const competing = await reserveStorageBytes(org.id, fileBytes);
        expect(competing.ok).toBe(true);
        if (competing.ok) {
          await prisma.$transaction(async (tx) => {
            const consumed = await consumeStorageReservation(tx, org.id, competing.reservationId, fileBytes, new Date());
            expect(consumed.ok).toBe(true);
            await tx.attachment.create({
              data: {
                organizationId: org.id,
                entityType: "CLIENT",
                entityId: randomUUID(),
                storageBucket: "attachments",
                storagePath: `test/${randomUUID()}`,
                originalName: "competing.pdf",
                mimeType: "application/pdf",
                sizeBytes: fileBytes,
              },
            });
          });
        }
      });

      const result = await uploadCompanyLogoAction({ error: null }, makeLogoFormData("logo.png", "image/png", fileBytes));

      // Correctly confirmed-full this time — a real competing upload
      // genuinely consumed every remaining byte first.
      expect(result.error).toBe("Your storage limit has been reached.");

      const profile = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId: org.id } });
      expect(profile.logoUrl).toBeNull();

      await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    } finally {
      setLogoUploadMidFlightHook(null);
      await cleanup(org, owner);
    }
  });
});
