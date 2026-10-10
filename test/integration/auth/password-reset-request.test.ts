import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// src/lib/auth/recovery-token.ts (transitively imported by password-reset.ts
// below) imports the real "server-only" marker package, which throws
// outside Next's own "react-server" resolve condition — same reasoning as
// test/integration/cron/routes.test.ts's own identical mock. Neutralizing
// the marker package doesn't touch any real logic.
vi.mock("server-only", () => ({}));

const { requestPasswordResetCore } = await import("@/lib/auth/password-reset");
import type { SendEmailFn } from "@/lib/email/resend-client";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testEmail } from "../../support/run-id";

// Sale-Ready Phase B, PR1 (Password Recovery). requestPasswordResetCore's
// own admin.generateLink() call goes through src/lib/auth/recovery-token.ts,
// which is TEST_MODE-branched — not set in this integration env (see
// test/integration/setup-env.ts), so it would otherwise fall to the real
// branch and need a real Supabase admin client. deps.generateToken and
// deps.sendEmail are the injectable seams this file uses instead (the
// former added specifically to make the "known email -> a token was
// generated -> an email was sent" chain deterministically testable here —
// see requestPasswordResetCore's own doc comment).

const ORIGINAL_FROM_EMAIL = process.env.INVITATION_FROM_EMAIL;

function setFromEmail(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.INVITATION_FROM_EMAIL;
  } else {
    process.env.INVITATION_FROM_EMAIL = value;
  }
}

// Platform Admin Credential / Recovery Hardening. Same save/restore
// shape as setFromEmail/ORIGINAL_FROM_EMAIL above, applied to
// PLATFORM_ADMIN_EMAILS — isPlatformAdmin() (src/lib/platform-admin/
// authorization.ts) reads this env var fresh on every call, so a test
// only ever needs to set it around the one assertion that needs it,
// never a module-level mock.
const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

function setPlatformAdminEmails(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.PLATFORM_ADMIN_EMAILS;
  } else {
    process.env.PLATFORM_ADMIN_EMAILS = value;
  }
}

const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

describe("requestPasswordResetCore — integration", () => {
  let fixtures: TestFixtures;
  const sentEmails: Array<{ to: string; subject: string }> = [];
  const capturingSend: SendEmailFn = async (input) => {
    sentEmails.push({ to: input.to, subject: input.subject });
    return { ok: true };
  };
  let tokenCounter = 0;
  const fakeGenerateToken = async () => {
    tokenCounter += 1;
    return { ok: true as const, tokenHash: `fake-token-${tokenCounter}` };
  };

  beforeAll(async () => {
    fixtures = await seedTestData();
    setFromEmail("Test <test@example.com>");
  });

  afterEach(() => {
    sentEmails.length = 0;
    // Belt-and-suspenders restore after every test, not only the ones
    // that explicitly set PLATFORM_ADMIN_EMAILS themselves — guarantees
    // no leakage into a later test regardless of ordering.
    setPlatformAdminEmails(ORIGINAL_PLATFORM_ADMIN_EMAILS);
  });

  afterAll(async () => {
    setFromEmail(ORIGINAL_FROM_EMAIL);
    await cleanupTestData(fixtures);
  });

  it("staff: a known email returns the generic message and actually sends the email", async () => {
    const result = await requestPasswordResetCore(
      { email: fixtures.owner.email, audience: "staff" },
      { sendEmail: capturingSend, generateToken: fakeGenerateToken },
    );
    expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
    expect(sentEmails).toEqual([{ to: fixtures.owner.email, subject: "Reset your password" }]);
  });

  // Platform Admin Credential / Recovery Hardening. requestPasswordResetCore's
  // own isPlatformAdmin() exclusion (src/lib/auth/password-reset.ts) —
  // the staff-audience-only guard this slice added. fixtures.owner is a
  // real, known Staff User; temporarily allowlisting their own email is
  // the only way to exercise "a real identity that also happens to be a
  // Platform Admin" without seeding a second user.
  describe("Platform Admin recovery exclusion (staff audience only)", () => {
    it("B. a known, allowlisted Platform Admin email returns the exact same generic message, but generates NO token and sends NO email", async () => {
      setPlatformAdminEmails(fixtures.owner.email);
      const generateToken = vi.fn(fakeGenerateToken);

      const result = await requestPasswordResetCore(
        { email: fixtures.owner.email, audience: "staff" },
        { sendEmail: capturingSend, generateToken },
      );

      expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
      expect(sentEmails).toHaveLength(0);
      expect(generateToken).not.toHaveBeenCalled();
    });

    it("E. normalization: a differently-cased/whitespace-padded allowlist entry still excludes the submitted (also differently-cased/padded) email — casing/whitespace cannot bypass the exclusion", async () => {
      setPlatformAdminEmails(`  ${fixtures.owner.email.toUpperCase()}  `);
      const generateToken = vi.fn(fakeGenerateToken);

      const result = await requestPasswordResetCore(
        { email: `  ${fixtures.owner.email}  `, audience: "staff" },
        { sendEmail: capturingSend, generateToken },
      );

      expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
      expect(sentEmails).toHaveLength(0);
      expect(generateToken).not.toHaveBeenCalled();
    });

    it("D. Portal reset is unaffected even when the submitted Portal email is itself (coincidentally) present in PLATFORM_ADMIN_EMAILS — the exclusion is staff-audience-only, by construction, not by this email happening to differ", async () => {
      setPlatformAdminEmails(fixtures.portalUser.email);
      const generateToken = vi.fn(fakeGenerateToken);

      const result = await requestPasswordResetCore(
        { email: fixtures.portalUser.email, audience: "portal" },
        { sendEmail: capturingSend, generateToken },
      );

      expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
      expect(sentEmails).toEqual([{ to: fixtures.portalUser.email, subject: "Reset your Client Portal password" }]);
      expect(generateToken).toHaveBeenCalledTimes(1);
    });

    it("an ordinary (non-allowlisted) known Staff email is completely unaffected by PLATFORM_ADMIN_EMAILS being set to a different value", async () => {
      setPlatformAdminEmails(testEmail("some-other-admin", "test.local"));
      const generateToken = vi.fn(fakeGenerateToken);

      const result = await requestPasswordResetCore(
        { email: fixtures.owner.email, audience: "staff" },
        { sendEmail: capturingSend, generateToken },
      );

      expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
      expect(sentEmails).toEqual([{ to: fixtures.owner.email, subject: "Reset your password" }]);
      expect(generateToken).toHaveBeenCalledTimes(1);
    });

    it("never writes anything to the User/PortalUser tables for an excluded Platform Admin request either — still a read-only lookup", async () => {
      setPlatformAdminEmails(fixtures.owner.email);
      const before = await prisma.user.count();
      await requestPasswordResetCore({ email: fixtures.owner.email, audience: "staff" }, { sendEmail: capturingSend });
      const after = await prisma.user.count();
      expect(after).toBe(before);
    });
  });

  it("staff: an unknown email returns the exact same generic message — never reveals non-existence", async () => {
    const unknownEmail = testEmail("never-signed-up", "test.local");
    const result = await requestPasswordResetCore(
      { email: unknownEmail, audience: "staff" },
      { sendEmail: capturingSend },
    );
    expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
    expect(sentEmails).toHaveLength(0);
  });

  it("portal: a known PortalUser email returns the generic message and actually sends the email", async () => {
    const result = await requestPasswordResetCore(
      { email: fixtures.portalUser.email, audience: "portal" },
      { sendEmail: capturingSend, generateToken: fakeGenerateToken },
    );
    expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
    expect(sentEmails).toEqual([{ to: fixtures.portalUser.email, subject: "Reset your Client Portal password" }]);
  });

  it("portal: an unknown email returns the exact same generic message", async () => {
    const unknownEmail = testEmail("never-a-portal-user", "test.local");
    const result = await requestPasswordResetCore(
      { email: unknownEmail, audience: "portal" },
      { sendEmail: capturingSend },
    );
    expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
    expect(sentEmails).toHaveLength(0);
  });

  it("a staff email submitted via the portal audience is treated as not found — no cross-audience match", async () => {
    // fixtures.owner is a real User but never a PortalUser.
    const result = await requestPasswordResetCore(
      { email: fixtures.owner.email, audience: "portal" },
      { sendEmail: capturingSend },
    );
    expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
    expect(sentEmails).toHaveLength(0);
  });

  it("a portal email submitted via the staff audience is treated as not found — no cross-audience match", async () => {
    // fixtures.portalUser is a real PortalUser but never a User.
    const result = await requestPasswordResetCore(
      { email: fixtures.portalUser.email, audience: "staff" },
      { sendEmail: capturingSend },
    );
    expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
    expect(sentEmails).toHaveLength(0);
  });

  it("trims surrounding whitespace from the submitted email before lookup", async () => {
    const result = await requestPasswordResetCore(
      { email: `  ${fixtures.owner.email}  `, audience: "staff" },
      { sendEmail: capturingSend, generateToken: fakeGenerateToken },
    );
    expect(result).toEqual({ error: null, message: GENERIC_MESSAGE });
    expect(sentEmails).toEqual([{ to: fixtures.owner.email, subject: "Reset your password" }]);
  });

  it("never throws or writes anything to the User/PortalUser tables — a read-only lookup", async () => {
    const before = await prisma.user.count();
    await requestPasswordResetCore({ email: fixtures.owner.email, audience: "staff" }, { sendEmail: capturingSend });
    const after = await prisma.user.count();
    expect(after).toBe(before);
  });
});
