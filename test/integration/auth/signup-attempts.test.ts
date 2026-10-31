import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { signup } from "@/app/(auth)/signup/actions";
import { portalSignup } from "@/app/portal/signup/actions";
import { GET as confirmGet } from "@/app/auth/confirm/route";
import { recordSignupAttempt, recordSignupActivation } from "@/lib/signup-attempts/record";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { setMockVerifyOtpConfig, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

// Platform Admin Growth V1, Slice A. Real-database proof (PGlite-backed
// Prisma, never mocked) that Staff signup identities are recorded
// idempotently and truthfully, activation completes only the matching
// row, Portal signup is excluded, and a failed analytics write never
// changes a real signup. generateToken / sendConfirmationEmail are
// injected exactly like every other signup suite here.

const createdAuthUserIds: string[] = [];
const createdUserIds: string[] = [];

function track(id: string): string {
  createdAuthUserIds.push(id);
  return id;
}

function signupForm(fields: { email: string; invitationToken?: string; organizationName?: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", "correct-horse-battery-1");
  formData.set("confirmPassword", "correct-horse-battery-1");
  if (fields.invitationToken) formData.set("invitationToken", fields.invitationToken);
  if (fields.organizationName) formData.set("organizationName", fields.organizationName);
  return formData;
}

const deliveredEmail = () => vi.fn().mockResolvedValue({ delivered: true });
const tokenFor = (authUserId: string, alreadyConfirmed = false) =>
  vi.fn().mockResolvedValue({ ok: true, tokenHash: "attempt-hash", alreadyConfirmed, authUserId });

describe("signup attempts — Staff signup identity recording (Growth V1, Slice A)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetNavigationMock();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.signupAttempt.deleteMany({ where: { authUserId: { in: createdAuthUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await cleanupTestData(fixtures);
  });

  it("standalone Staff signup records exactly one STANDALONE attempt with a normalized email, no activation and no User row", async () => {
    const authUserId = track(randomUUID());
    const email = testEmail(`Attempt-Standalone-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);

    const before = Date.now();
    const result = await signup(
      { error: null },
      signupForm({ email: `  ${email.toUpperCase()} `.trim(), organizationName: "Attempt Co" }),
      { generateToken: tokenFor(authUserId), sendConfirmationEmail: deliveredEmail() },
    );
    const after = Date.now();

    expect(result.message).toMatch(/check your email/i);
    const row = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    expect(row.origin).toBe("STANDALONE");
    expect(row.email).toBe(email.toLowerCase());
    expect(row.attemptCount).toBe(1);
    expect(row.activatedAt).toBeNull();
    expect(row.recordedVia).toBe("LIVE");
    expect(row.firstAttemptedAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(row.firstAttemptedAt.getTime()).toBeLessThanOrEqual(after + 1_000);
    expect(row.lastAttemptedAt.getTime()).toBe(row.firstAttemptedAt.getTime());
    expect(await prisma.user.findUnique({ where: { id: authUserId } })).toBeNull();
  });

  it("invited Staff signup records origin INVITED from the invitation token — not from the absence of an organization", async () => {
    const authUserId = track(randomUUID());
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: fixtures.orgA.id,
        email: testEmail(`attempt-invited-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId),
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });

    await signup({ error: null }, signupForm({ email: invitation.email, invitationToken: invitation.token }), {
      generateToken: tokenFor(authUserId),
      sendConfirmationEmail: deliveredEmail(),
    });

    const row = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    expect(row.origin).toBe("INVITED");
    expect(row.email).toBe(invitation.email.toLowerCase());
  });

  it("an invalid invitation token is rejected before any Auth call and records nothing", async () => {
    const generateToken = tokenFor(randomUUID());
    const result = await signup(
      { error: null },
      signupForm({ email: testEmail("attempt-bad-invite", TEST_EMAIL_DOMAIN), invitationToken: randomUUID() }),
      { generateToken, sendConfirmationEmail: deliveredEmail() },
    );
    expect(result.error).toMatch(/no longer available/i);
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("Portal signup never records a Staff attempt, even though it shares the Auth token helper", async () => {
    const authUserId = track(randomUUID());
    const result = await portalSignup(
      { error: null },
      (() => {
        const f = new FormData();
        f.set("email", testEmail(`attempt-portal-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN));
        f.set("password", "correct-horse-battery-1");
        f.set("confirmPassword", "correct-horse-battery-1");
        return f;
      })(),
      { generateToken: tokenFor(authUserId), sendConfirmationEmail: deliveredEmail() },
    );
    expect(result.message).toMatch(/check your email/i);
    expect(await prisma.signupAttempt.findUnique({ where: { authUserId } })).toBeNull();
  });

  it("a missing authUserId from the Auth helper skips recording and does not affect signup", async () => {
    const result = await signup({ error: null }, signupForm({ email: testEmail(`attempt-noid-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), organizationName: "No Id Co" }), {
      generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "h", alreadyConfirmed: false }),
      sendConfirmationEmail: deliveredEmail(),
    });
    expect(result.message).toMatch(/check your email/i);
  });

  it("repeated signup for the same Auth user is one row: attemptCount increments, firstAttemptedAt is kept and lastAttemptedAt advances", async () => {
    const authUserId = track(randomUUID());
    const email = testEmail(`attempt-retry-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const args = { generateToken: tokenFor(authUserId), sendConfirmationEmail: deliveredEmail() };

    await signup({ error: null }, signupForm({ email, organizationName: "Retry Co" }), args);
    const first = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    await new Promise((r) => setTimeout(r, 15));
    await signup({ error: null }, signupForm({ email, organizationName: "Retry Co" }), args);
    await signup({ error: null }, signupForm({ email, organizationName: "Retry Co" }), args);

    expect(await prisma.signupAttempt.count({ where: { authUserId } })).toBe(1);
    const row = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    expect(row.attemptCount).toBe(3);
    expect(row.firstAttemptedAt.getTime()).toBe(first.firstAttemptedAt.getTime());
    expect(row.lastAttemptedAt.getTime()).toBeGreaterThan(first.firstAttemptedAt.getTime());
    expect(row.origin).toBe("STANDALONE");
    expect(row.email).toBe(email.toLowerCase());
  });

  it("concurrent recording is order-independent: one row, a truthful count, the earliest first and the latest last timestamp", async () => {
    const authUserId = track(randomUUID());
    const email = testEmail(`attempt-race-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const base = Date.UTC(2026, 10, 1, 12, 0, 0);
    // Deliberately scrambled so the commit order never matches clock order.
    const offsets = [5, 1, 8, 3, 0, 7, 2, 6, 4];

    const results = await Promise.all(
      offsets.map((offset) =>
        recordSignupAttempt({ authUserId, email, origin: "STANDALONE" }, { now: new Date(base + offset * 1_000) }),
      ),
    );

    expect(results.every((r) => r.recorded)).toBe(true);
    expect(await prisma.signupAttempt.count({ where: { authUserId } })).toBe(1);
    const row = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    expect(row.attemptCount).toBe(offsets.length);
    expect(row.firstAttemptedAt.getTime()).toBe(base);
    expect(row.lastAttemptedAt.getTime()).toBe(base + 8_000);
  });

  it("a later retry with an earlier clock can lower firstAttemptedAt but never raise it, and never lowers lastAttemptedAt", async () => {
    const authUserId = track(randomUUID());
    const email = testEmail(`attempt-order-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const base = Date.UTC(2026, 10, 2, 9, 0, 0);

    await recordSignupAttempt({ authUserId, email, origin: "STANDALONE" }, { now: new Date(base + 60_000) });
    await recordSignupAttempt({ authUserId, email, origin: "STANDALONE" }, { now: new Date(base) });
    await recordSignupAttempt({ authUserId, email, origin: "STANDALONE" }, { now: new Date(base + 30_000) });

    const row = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    expect(row.attemptCount).toBe(3);
    expect(row.firstAttemptedAt.getTime()).toBe(base);
    expect(row.lastAttemptedAt.getTime()).toBe(base + 60_000);
  });

  it("origin and email are set at the first recorded attempt and are not rewritten by a later retry", async () => {
    const authUserId = track(randomUUID());
    const email = testEmail(`attempt-first-wins-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    await recordSignupAttempt({ authUserId, email, origin: "STANDALONE" });
    await recordSignupAttempt({ authUserId, email: testEmail("different", TEST_EMAIL_DOMAIN), origin: "INVITED" });
    const row = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    expect(row.origin).toBe("STANDALONE");
    expect(row.email).toBe(email.toLowerCase());
    expect(row.attemptCount).toBe(2);
  });

  it("email confirmation (real /auth/confirm route) creates the User and activates exactly that attempt at the User's createdAt", async () => {
    const authUserId = track(randomUUID());
    createdUserIds.push(authUserId);
    const email = testEmail(`attempt-confirm-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const organizationName = `Attempt Confirm Co ${randomUUID().slice(0, 6)}`;

    let confirmUrl = "";
    await signup({ error: null }, signupForm({ email, organizationName }), {
      generateToken: tokenFor(authUserId),
      sendConfirmationEmail: vi.fn().mockImplementation(async (p: { confirmUrl: string }) => {
        confirmUrl = p.confirmUrl;
        return { delivered: true };
      }),
    });
    expect((await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } })).activatedAt).toBeNull();

    setMockVerifyOtpConfig({ kind: "success", user: { id: authUserId, email, user_metadata: { organizationName } } });
    const parsed = new URL(confirmUrl);
    const response = await confirmGet(new Request(`http://localhost${parsed.pathname}${parsed.search}`));
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: authUserId } });
    const row = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    expect(row.activatedAt?.getTime()).toBe(user.createdAt.getTime());
    expect(row.activatedAt!.getTime()).toBeGreaterThanOrEqual(row.firstAttemptedAt.getTime());

    const membership = await prisma.membership.findFirst({ where: { userId: authUserId, role: "OWNER" } });
    await prisma.organization.deleteMany({ where: { id: membership!.organizationId } });
  });

  it("confirming twice (a repeat click) does not move the recorded activation time", async () => {
    const authUserId = track(randomUUID());
    createdUserIds.push(authUserId);
    const email = testEmail(`attempt-twice-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const organizationName = `Attempt Twice Co ${randomUUID().slice(0, 6)}`;

    await recordSignupAttempt({ authUserId, email, origin: "STANDALONE" });
    // The mock's verifyOtp config is consumed by each call, so it is armed once per click.
    const click = () => {
      setMockVerifyOtpConfig({ kind: "success", user: { id: authUserId, email, user_metadata: { organizationName } } });
      return confirmGet(new Request("http://localhost/auth/confirm?token_hash=t&type=signup&next=%2Fdashboard"));
    };

    await click();
    const afterFirst = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    await new Promise((r) => setTimeout(r, 15));
    await click();
    const afterSecond = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });

    expect(afterFirst.activatedAt).not.toBeNull();
    expect(afterSecond.activatedAt?.getTime()).toBe(afterFirst.activatedAt?.getTime());
    const membership = await prisma.membership.findFirst({ where: { userId: authUserId, role: "OWNER" } });
    await prisma.organization.deleteMany({ where: { id: membership!.organizationId } });
  });

  it("immediate-session signup (email confirmation disabled) records the attempt and activates it in the same request", async () => {
    const authUserId = track(randomUUID());
    createdUserIds.push(authUserId);
    const email = testEmail(`attempt-immediate-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const organizationName = `Attempt Immediate Co ${randomUUID().slice(0, 6)}`;
    setMockVerifyOtpConfig({ kind: "success", user: { id: authUserId, email } });

    let caught: unknown;
    try {
      await signup({ error: null }, signupForm({ email, organizationName }), {
        generateToken: tokenFor(authUserId, true),
        sendConfirmationEmail: deliveredEmail(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);

    const row = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } });
    expect(row.origin).toBe("STANDALONE");
    expect(row.activatedAt).not.toBeNull();
    const membership = await prisma.membership.findFirst({ where: { userId: authUserId, role: "OWNER" } });
    await prisma.organization.deleteMany({ where: { id: membership!.organizationId } });
  });

  it("activation is idempotent and monotonic: the first recorded time is never overwritten", async () => {
    const authUserId = track(randomUUID());
    await recordSignupAttempt({ authUserId, email: testEmail(`attempt-idem-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), origin: "STANDALONE" });
    const t1 = new Date("2026-11-03T10:00:00.000Z");
    const t2 = new Date("2026-11-04T10:00:00.000Z");

    expect(await recordSignupActivation({ authUserId, activatedAt: t1 })).toEqual({ recorded: true, matched: true });
    expect(await recordSignupActivation({ authUserId, activatedAt: t2 })).toEqual({ recorded: true, matched: false });

    expect((await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } })).activatedAt?.toISOString()).toBe(t1.toISOString());
  });

  it("activation never creates a row for an identity with no recorded attempt (no fabricated signup time)", async () => {
    const authUserId = randomUUID();
    expect(await recordSignupActivation({ authUserId, activatedAt: new Date() })).toEqual({ recorded: true, matched: false });
    expect(await prisma.signupAttempt.findUnique({ where: { authUserId } })).toBeNull();
  });

  it("activating one identity leaves every other identity's row untouched", async () => {
    const a = track(randomUUID());
    const b = track(randomUUID());
    for (const id of [a, b]) {
      await recordSignupAttempt({ authUserId: id, email: testEmail(`attempt-iso-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), origin: "STANDALONE" });
    }
    const beforeB = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: b } });

    await recordSignupActivation({ authUserId: a, activatedAt: new Date("2026-11-05T00:00:00.000Z") });

    const afterB = await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: b } });
    expect(afterB).toEqual(beforeB);
    expect((await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId: a } })).activatedAt).not.toBeNull();
  });

  it("an existing account without a recorded attempt (pre-table history) provisions normally and gains no row", async () => {
    const authUserId = randomUUID();
    createdUserIds.push(authUserId);
    const email = testEmail(`attempt-legacy-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const organizationName = `Attempt Legacy Co ${randomUUID().slice(0, 6)}`;
    setMockVerifyOtpConfig({ kind: "success", user: { id: authUserId, email, user_metadata: { organizationName } } });

    const response = await confirmGet(new Request("http://localhost/auth/confirm?token_hash=t&type=signup&next=%2Fdashboard"));
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");

    expect(await prisma.user.findUnique({ where: { id: authUserId } })).not.toBeNull();
    expect(await prisma.signupAttempt.findUnique({ where: { authUserId } })).toBeNull();
    const membership = await prisma.membership.findFirst({ where: { userId: authUserId, role: "OWNER" } });
    await prisma.organization.deleteMany({ where: { id: membership!.organizationId } });
  });

  it("an analytics write failure never changes a real signup, and the diagnostic carries no email, id or token", async () => {
    const authUserId = track(randomUUID());
    const email = testEmail(`attempt-fail-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(prisma.signupAttempt, "upsert").mockRejectedValue(new Error(`boom ${email} ${authUserId} password=correct-horse-battery-1`));
    const sendConfirmationEmail = deliveredEmail();

    const result = await signup({ error: null }, signupForm({ email, organizationName: "Failure Co" }), {
      generateToken: tokenFor(authUserId),
      sendConfirmationEmail,
    });

    expect(result.error).toBeNull();
    expect(result.message).toMatch(/check your email/i);
    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(await prisma.signupAttempt.findUnique({ where: { authUserId } })).toBeNull();

    const logged = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("[signup-attempts] record_attempt failed (UNKNOWN).");
    for (const sensitive of [email, authUserId, "password", "correct-horse", "attempt-hash"]) {
      expect(logged).not.toContain(sensitive);
    }
  });

  it("even a recorder double that throws cannot fail the signup (defense in depth)", async () => {
    const authUserId = randomUUID();
    const sendConfirmationEmail = deliveredEmail();
    const result = await signup({ error: null }, signupForm({ email: testEmail(`attempt-throw-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), organizationName: "Throw Co" }), {
      generateToken: tokenFor(authUserId),
      sendConfirmationEmail,
      recordSignupAttempt: vi.fn().mockRejectedValue(new Error("unexpected")),
    });
    expect(result.message).toMatch(/check your email/i);
    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("a failed confirmation email still leaves the attempt recorded (the Auth user exists) and reports the existing error", async () => {
    const authUserId = track(randomUUID());
    const result = await signup({ error: null }, signupForm({ email: testEmail(`attempt-nomail-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), organizationName: "No Mail Co" }), {
      generateToken: tokenFor(authUserId),
      sendConfirmationEmail: vi.fn().mockResolvedValue({ delivered: false }),
    });
    expect(result.error).toMatch(/confirmation email could not be sent/i);
    expect((await prisma.signupAttempt.findUniqueOrThrow({ where: { authUserId } })).attemptCount).toBe(1);
  });
});
