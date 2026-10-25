import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  sendRecoveryPhoneVerificationCodeAction,
  verifyRecoveryPhoneCodeAction,
  updateRecoveryPhoneAction,
} from "@/app/(dashboard)/settings/account/actions";
import type { PhoneVerificationProvider, SendCodeResult, VerifyCodeResult } from "@/lib/phone/twilio-verify";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { resetNavigationMock, RedirectSignal } from "../../support/navigation-mock";

/**
 * Phone Recovery, Slice B2. Proves the two new Server Actions' own
 * security-critical invariants — never SMS, never real Twilio — via
 * `deps.provider` dependency injection (see actions.ts's own doc
 * comment on `PhoneVerificationDeps`, the same seam
 * requestPasswordResetCore's own `deps.generateToken` establishes).
 */

const VALID_CODE = "123456";

/**
 * Mirrors twilio-verify.ts's own TEST_MODE in-process fake exactly (phone-
 * keyed, single-use, "no pending challenge for this phone" denies) — but
 * independently controllable per test via DI, matching the audit's own
 * named "FakePhoneVerificationProvider" test double.
 */
function createFakeProvider(): PhoneVerificationProvider & { sentTo: string[]; verifyCalls: Array<[string, string]> } {
  const pending = new Map<string, string>();
  const sentTo: string[] = [];
  const verifyCalls: Array<[string, string]> = [];
  return {
    sentTo,
    verifyCalls,
    async sendCode(phone: string): Promise<SendCodeResult> {
      sentTo.push(phone);
      pending.set(phone, VALID_CODE);
      return { ok: true };
    },
    async verifyCode(phone: string, code: string): Promise<VerifyCodeResult> {
      verifyCalls.push([phone, code]);
      const expected = pending.get(phone);
      if (expected && expected === code) {
        pending.delete(phone);
        return { ok: true, outcome: "approved" };
      }
      return { ok: true, outcome: "denied" };
    },
  };
}

function alwaysProviderError(): PhoneVerificationProvider {
  return {
    async sendCode() {
      return { ok: false, reason: "provider_error" };
    },
    async verifyCode() {
      return { ok: false, reason: "provider_error" };
    },
  };
}

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function getUserPhoneState(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, select: { phone: true, phoneVerifiedAt: true } });
}

describe("Recovery phone verification — Server Actions (send/verify)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  beforeEach(() => {
    resetNavigationMock();
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: null, phoneVerifiedAt: null } });
    await prisma.user.update({ where: { id: fixtures.admin.id }, data: { phone: null, phoneVerifiedAt: null } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("authentication", () => {
    it("send: an unauthenticated caller is redirected to login, never reaches the provider", async () => {
      const provider = createFakeProvider();
      await expect(
        sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider }),
      ).rejects.toThrow(RedirectSignal);
      expect(provider.sentTo).toHaveLength(0);
    });

    it("verify: an unauthenticated caller is redirected to login, never reaches the provider", async () => {
      const provider = createFakeProvider();
      await expect(
        verifyRecoveryPhoneCodeAction({ error: null }, buildFormData({ code: VALID_CODE }), { provider }),
      ).rejects.toThrow(RedirectSignal);
      expect(provider.verifyCalls).toHaveLength(0);
    });
  });

  it("send: rejected with no phone on file, provider never called", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();

    const result = await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider });

    expect(result.error).toBe("Add a phone number first.");
    expect(provider.sentTo).toHaveLength(0);
  });

  it("send: an already-verified phone is a safe no-op, provider never called", async () => {
    await prisma.user.update({
      where: { id: fixtures.owner.id },
      data: { phone: "+66812345678", phoneVerifiedAt: new Date() },
    });
    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();

    const result = await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider });

    expect(result.error).toBeNull();
    expect(result.message).toBe("This phone number is already verified.");
    expect(provider.sentTo).toHaveLength(0);
  });

  it("send: uses the phone stored in the DB — client-supplied form fields (including a forged 'phone') are completely ignored", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();

    // A forged "phone" field, as if an attacker tampered with the
    // request — the action takes no "phone" input at all; this proves
    // it's silently ignored, not merely absent from the happy path.
    await sendRecoveryPhoneVerificationCodeAction(
      { error: null },
      buildFormData({ phone: "+15555550123" }),
      { provider },
    );

    expect(provider.sentTo).toEqual(["+66812345678"]);
  });

  it("verify: a correct code sets phoneVerifiedAt", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();
    await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider });

    const result = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: VALID_CODE }),
      { provider },
    );

    expect(result.error).toBeNull();
    expect(result.message).toBe("Phone verified.");
    const row = await getUserPhoneState(fixtures.owner.id);
    expect(row.phone).toBe("+66812345678");
    expect(row.phoneVerifiedAt).not.toBeNull();
  });

  it("verify: an invalid (wrong) code leaves phoneVerifiedAt null, with a generic error", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();
    await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider });

    const result = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: "000000" }),
      { provider },
    );

    expect(result.error).toBe("That code is invalid or has expired. Request a new one.");
    const row = await getUserPhoneState(fixtures.owner.id);
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("verify: an expired/denied code (provider reports denied explicitly) leaves phoneVerifiedAt null", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);
    const deniedProvider: PhoneVerificationProvider = {
      async sendCode() {
        return { ok: true };
      },
      async verifyCode() {
        return { ok: true, outcome: "denied" };
      },
    };

    const result = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: VALID_CODE }),
      { provider: deniedProvider },
    );

    expect(result.error).toBe("That code is invalid or has expired. Request a new one.");
    const row = await getUserPhoneState(fixtures.owner.id);
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("verify: a provider failure (network/outage) leaves phoneVerifiedAt null, with a distinct retry-later message", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: VALID_CODE }),
      { provider: alwaysProviderError() },
    );

    expect(result.error).toBe("Phone verification isn't available right now. Please try again later.");
    const row = await getUserPhoneState(fixtures.owner.id);
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("send: a provider failure also never sets phoneVerifiedAt and surfaces a generic error", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await sendRecoveryPhoneVerificationCodeAction(
      { error: null },
      buildFormData({}),
      { provider: alwaysProviderError() },
    );

    expect(result.error).toBe("Phone verification isn't available right now. Please try again later.");
    const row = await getUserPhoneState(fixtures.owner.id);
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("CRITICAL: a code sent to the phone on file cannot verify a DIFFERENT phone the user replaced it with before submitting", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();

    // 1. Send a code to Phone A (+66812345678).
    await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider });
    expect(provider.sentTo).toEqual(["+66812345678"]);

    // 2. Replace the stored phone with Phone B — the existing B1 action,
    // unmodified, still allowed for an unverified phone.
    const replaceResult = await updateRecoveryPhoneAction(
      { error: null },
      buildFormData({ intent: "save", country: "TH", phone: "089-999-8888" }),
    );
    expect(replaceResult.error).toBeNull();
    expect((await getUserPhoneState(fixtures.owner.id)).phone).toBe("+66899998888");

    // 3. Submit the code that was issued for Phone A. The action always
    // re-reads the CURRENT phone (now B) and checks against that — the
    // fake provider has no pending entry for B, so this must be denied.
    const verifyResult = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: VALID_CODE }),
      { provider },
    );

    expect(verifyResult.error).toBe("That code is invalid or has expired. Request a new one.");
    expect(provider.verifyCalls).toEqual([["+66899998888", VALID_CODE]]);
    const row = await getUserPhoneState(fixtures.owner.id);
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("race protection: if User.phone changes between a provider approval and the DB write, the write fails closed (count 0), never marking the new phone verified off the old code", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);

    // A provider that always reports "approved" regardless of which
    // phone/code it's asked about — simulates the exact race window the
    // conditional updateMany guards against: Twilio approves the
    // verification for the phone it was asked about at call-time, but by
    // the time this app's own DB write runs, a concurrent request has
    // already changed User.phone to something else.
    const alwaysApproves: PhoneVerificationProvider = {
      async sendCode() {
        return { ok: true };
      },
      async verifyCode() {
        // Simulate the race: change the phone AFTER the provider has
        // already "approved", but BEFORE this function returns to the
        // action's own updateMany call.
        await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66899998888" } });
        return { ok: true, outcome: "approved" };
      },
    };

    const result = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: VALID_CODE }),
      { provider: alwaysApproves },
    );

    expect(result.error).toBe("This phone number changed before verification completed. Request a new code.");
    const row = await getUserPhoneState(fixtures.owner.id);
    expect(row.phone).toBe("+66899998888");
    expect(row.phoneVerifiedAt).toBeNull();
  });

  it("a second user can never verify the first user's phone — identity is always self-referential", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    await prisma.user.update({ where: { id: fixtures.admin.id }, data: { phone: "+66899998888" } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();
    await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider });

    // Switch identity to the admin and submit the code that was actually
    // issued for the owner's phone. verifyRecoveryPhoneCodeAction always
    // re-reads the CALLING user's own phone (the admin's), never the
    // owner's — so this can only ever check "+66899998888" against the
    // owner's code, which was never issued for that number.
    actAs(fixtures.admin, fixtures.orgA.id);
    const result = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: VALID_CODE }),
      { provider },
    );

    expect(result.error).toBe("That code is invalid or has expired. Request a new one.");
    expect(provider.verifyCalls).toEqual([["+66899998888", VALID_CODE]]);
    const ownerRow = await getUserPhoneState(fixtures.owner.id);
    const adminRow = await getUserPhoneState(fixtures.admin.id);
    expect(ownerRow.phoneVerifiedAt).toBeNull();
    expect(adminRow.phoneVerifiedAt).toBeNull();
  });

  it("two different users can each independently verify their own distinct phones with no unique-constraint conflict", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    await prisma.user.update({ where: { id: fixtures.admin.id }, data: { phone: "+66899998888" } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const ownerProvider = createFakeProvider();
    await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider: ownerProvider });
    const ownerResult = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: VALID_CODE }),
      { provider: ownerProvider },
    );
    expect(ownerResult.error).toBeNull();

    actAs(fixtures.admin, fixtures.orgA.id);
    const adminProvider = createFakeProvider();
    await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider: adminProvider });
    const adminResult = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: VALID_CODE }),
      { provider: adminProvider },
    );
    expect(adminResult.error).toBeNull();

    expect((await getUserPhoneState(fixtures.owner.id)).phoneVerifiedAt).not.toBeNull();
    expect((await getUserPhoneState(fixtures.admin.id)).phoneVerifiedAt).not.toBeNull();
  });

  it("Portal is completely unaffected — neither action ever reads or writes PortalUser", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    const before = await prisma.portalUser.findUniqueOrThrow({ where: { id: fixtures.portalUser.id } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();
    await sendRecoveryPhoneVerificationCodeAction({ error: null }, buildFormData({}), { provider });
    await verifyRecoveryPhoneCodeAction({ error: null }, buildFormData({ code: VALID_CODE }), { provider });

    const after = await prisma.portalUser.findUniqueOrThrow({ where: { id: fixtures.portalUser.id } });
    expect(after).toEqual(before);
  });

  it("verify: a malformed code is rejected by format validation before any provider call", async () => {
    await prisma.user.update({ where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    actAs(fixtures.owner, fixtures.orgA.id);
    const provider = createFakeProvider();

    const result = await verifyRecoveryPhoneCodeAction(
      { error: null },
      buildFormData({ code: "abc" }),
      { provider },
    );

    expect(result.error).toBe("That code is invalid or has expired. Request a new one.");
    expect(provider.verifyCalls).toHaveLength(0);
  });
});
