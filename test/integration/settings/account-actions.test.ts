import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateRecoveryPhoneAction } from "@/app/(dashboard)/settings/account/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). Proves the Server Action layer itself —
 * identity resolution (only the calling User's own row is ever read or
 * written), normalization-before-storage, the verification-clearing
 * invariant, duplicate-phone handling, and the verified-phone read-only
 * contract. Mirrors test/integration/settings/custom-statuses-actions.test.ts's
 * own structure (seed/actAs/resetAuthMock/cleanup shape).
 */

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

async function getUserRow(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id } });
}

describe("Recovery phone Settings — Server Action (updateRecoveryPhoneAction)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    resetAuthMock();
    // Reset both owner and admin fixture rows back to a clean phone
    // state after every test — this action mutates real fixture Users,
    // unlike most Settings actions tests (which mutate org-scoped child
    // rows cleaned up in bulk); a per-test reset keeps every test
    // independent regardless of execution order.
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: null, phoneVerifiedAt: null } });
    await prisma.user.update({ where: { id: fixtures.admin.id }, data: { phone: null, phoneVerifiedAt: null } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("an authenticated Staff user adds an unverified phone, stored as normalized E.164, with phoneVerifiedAt remaining null", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "081-234-5678" }),
    );

    expect(result.error).toBeNull();
    const row = await getUserRow(fixtures.owner.id);
    expect(row.phone).toBe("+66812345678");
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("rejects an invalid phone number, with no row mutation", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "123" }),
    );

    expect(result.error).toBe("Enter a valid phone number.");
    const row = await getUserRow(fixtures.owner.id);
    expect(row.phone).toBeNull();
  });

  it("rejects an empty phone submission", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "   " }),
    );

    expect(result.error).toBe("Enter a phone number.");
  });

  it("rejects a duplicate phone already used by a different Staff user, without disclosing who owns it", async () => {
    actAs(fixtures.admin, fixtures.orgA.id);
    const first = await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "081-111-2222" }),
    );
    expect(first.error).toBeNull();

    actAs(fixtures.owner, fixtures.orgA.id);
    const second = await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "081-111-2222" }),
    );

    expect(second.error).toBe("This phone number is already in use.");
    expect(second.error).not.toContain(fixtures.admin.email);
    expect(second.error).not.toContain(fixtures.admin.id);
    const ownerRow = await getUserRow(fixtures.owner.id);
    expect(ownerRow.phone).toBeNull();
  });

  it("only ever mutates the calling identity's own row — never another user's", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "081-234-5678" }),
    );

    const adminRow = await getUserRow(fixtures.admin.id);
    expect(adminRow.phone).toBeNull();
  });

  it("changing an unverified phone to a genuinely different number works, and still leaves phoneVerifiedAt null", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "081-234-5678" }),
    );

    const result = await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "089-999-8888" }),
    );

    expect(result.error).toBeNull();
    const row = await getUserRow(fixtures.owner.id);
    expect(row.phone).toBe("+66899998888");
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("removing an unverified phone clears both phone and phoneVerifiedAt", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "081-234-5678" }),
    );

    const result = await updateRecoveryPhoneAction({ error: null }, buildFormData({ intent: "remove" }));

    expect(result.error).toBeNull();
    const row = await getUserRow(fixtures.owner.id);
    expect(row.phone).toBeNull();
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("removing when no phone is stored is a harmless no-op, not an error", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await updateRecoveryPhoneAction({ error: null }, buildFormData({ intent: "remove" }));
    expect(result.error).toBeNull();
    expect(result.message).toBe("No recovery phone to remove.");
  });

  describe("verified-phone protection (B1 read-only contract)", () => {
    it("rejects an attempt to CHANGE an already-verified phone", async () => {
      await prisma.user.update({
        where: { id: fixtures.owner.id },
        data: { phone: "+66812345678", phoneVerifiedAt: new Date() },
      });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await updateRecoveryPhoneAction(
        { error: null },
        buildFormData({ intent: "save", country: "TH", phone: "089-999-8888" }),
      );

      expect(result.error).toBe(
        "Changing a verified recovery phone will be available after re-authentication support is added.",
      );
      const row = await getUserRow(fixtures.owner.id);
      expect(row.phone).toBe("+66812345678");
      expect(row.phoneVerifiedAt).not.toBeNull();
    });

    it("rejects an attempt to REMOVE an already-verified phone", async () => {
      const verifiedAt = new Date();
      await prisma.user.update({
        where: { id: fixtures.owner.id },
        data: { phone: "+66812345678", phoneVerifiedAt: verifiedAt },
      });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await updateRecoveryPhoneAction({ error: null }, buildFormData({ intent: "remove" }));

      expect(result.error).toBe(
        "Changing a verified recovery phone will be available after re-authentication support is added.",
      );
      const row = await getUserRow(fixtures.owner.id);
      expect(row.phone).toBe("+66812345678");
      expect(row.phoneVerifiedAt?.getTime()).toBe(verifiedAt.getTime());
    });

    it("resubmitting the SAME verified number unchanged is still rejected (verified = read-only, not just change-detection)", async () => {
      await prisma.user.update({
        where: { id: fixtures.owner.id },
        data: { phone: "+66812345678", phoneVerifiedAt: new Date() },
      });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await updateRecoveryPhoneAction(
        { error: null },
        buildFormData({ intent: "save", country: "TH", phone: "081-234-5678" }),
      );

      expect(result.error).toBe(
        "Changing a verified recovery phone will be available after re-authentication support is added.",
      );
    });
  });

  it("Portal is completely unaffected — the action never reads or writes PortalUser", async () => {
    const before = await prisma.portalUser.findUniqueOrThrow({ where: { id: fixtures.portalUser.id } });

    actAs(fixtures.owner, fixtures.orgA.id);
    await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "081-234-5678" }),
    );

    const after = await prisma.portalUser.findUniqueOrThrow({ where: { id: fixtures.portalUser.id } });
    expect(after).toEqual(before);
  });
});
