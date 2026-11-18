import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitCheck, RateLimitConfig } from "@/lib/rate-limit";

const sendEmailViaResend = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/resend-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/resend-client")>("@/lib/email/resend-client");
  return { ...actual, sendEmailViaResend };
});

// test/integration/setup-mocks.ts globally mocks @/lib/rate-limit's
// checkRateLimit to an unconditional `{ limited: false }` for every
// integration test in this process — the real store (src/lib/rate-limit/
// store.ts) is a module-level singleton Map that would otherwise persist
// across unrelated test files (confirmed directly: even 8 consecutive
// real calls with an identical key never tripped the real 5/hour limit
// under that global mock — the limiter's own counting logic is deliberately
// never exercised at this layer; see that file's own comment, and §E below
// for what this file tests instead of real counting). This file's own
// override takes precedence for this file only, and is restored to the
// same always-allow default after each test, so no other test in this
// file (or process) is affected by it.
const checkRateLimit = vi.hoisted(() => vi.fn<(config: RateLimitConfig, identifier: string) => RateLimitCheck>(() => ({ limited: false })));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit };
});

import { prisma } from "@/lib/prisma";
import { resendClientInvitationAction } from "@/app/(dashboard)/clients/[id]/portal-access-actions";
import { resolveValidPortalSignupInvitation } from "@/lib/invitations/resolve-portal-signup-invitation";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";

/**
 * Coverage gap closure: a read-only audit (main d61af61effb53116acde84c387956f3cf0f26f51)
 * reported that resendClientInvitationAction (src/app/(dashboard)/clients/[id]/
 * portal-access-actions.ts) had no dedicated tests anywhere — confirmed
 * independently before writing this file (two repo-wide searches, by function
 * name and by looser "resend"+"client"/"portal" phrasing, both empty). This
 * file follows the same state-machine pattern test/integration/invitations/
 * lifecycle.test.ts already established for the Staff Team invitation's own
 * resendInvitationAction, extended with email-content and delivery-failure
 * assertions using this repo's own vi.mock(sendEmailViaResend) convention
 * (see test/integration/feedback-widget/feedback-actions.test.ts).
 *
 * Scope note: this only verifies the ClientInvitation row's own lifecycle
 * (token rotation, status, expiry, tenant isolation, rate-limit wiring,
 * email call content) against the real Prisma-backed test database. It does
 * NOT and cannot establish what Supabase's real Admin API does when a person
 * with an existing, still-unconfirmed Auth identity submits the Portal
 * signup form again with a freshly-invited token — that is a separate,
 * genuinely open question this file makes no claim about.
 */

async function createClientInvitation(
  fixtures: TestFixtures,
  overrides: Partial<{ status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"; expiresAt: Date; clientId: string }> = {},
) {
  return prisma.clientInvitation.create({
    data: {
      clientId: overrides.clientId ?? fixtures.clientA.id,
      email: testEmail(`client-invite-resend-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId),
      token: randomUUID(),
      status: overrides.status ?? "PENDING",
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitedById: fixtures.owner.id,
    },
  });
}

describe("Client Portal invitation resend — resendClientInvitationAction", () => {
  let fixtures: TestFixtures;
  const ORIGINAL_FROM_EMAIL = process.env.INVITATION_FROM_EMAIL;

  beforeAll(async () => {
    fixtures = await seedTestData();
    process.env.INVITATION_FROM_EMAIL = "Aqenra <no-reply@aqenra.test>";
  });

  beforeEach(() => {
    sendEmailViaResend.mockReset();
    sendEmailViaResend.mockResolvedValue({ ok: true });
    checkRateLimit.mockClear();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
    if (ORIGINAL_FROM_EMAIL === undefined) delete process.env.INVITATION_FROM_EMAIL;
    else process.env.INVITATION_FROM_EMAIL = ORIGINAL_FROM_EMAIL;
  });

  describe("A. successful resend", () => {
    it("OWNER resends a PENDING invitation: rotates the token, stays PENDING, refreshes the expiry, the old token stops resolving, the new one does, exactly one Activity row is logged, the email call receives the new link, and no User/PortalUser/duplicate-invitation row is created", async () => {
      const invitation = await createClientInvitation(fixtures);
      const originalToken = invitation.token;
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBeNull();
      expect(result.message).toBe("Invitation resent.");
      expect(result.token).toBeDefined();
      expect(result.token).not.toBe(originalToken);

      const updated = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(updated.status).toBe("PENDING");
      expect(updated.token).toBe(result.token);
      expect(updated.token).not.toBe(originalToken);
      expect(updated.expiresAt.getTime()).toBeGreaterThan(invitation.expiresAt.getTime());

      // The old token is genuinely gone from the row, not merely
      // superseded by status — a lookup by it resolves to nothing, exactly
      // like a forged/nonexistent token.
      const oldTokenStillResolves = await resolveValidPortalSignupInvitation(originalToken);
      expect(oldTokenStillResolves).toBeNull();
      const newTokenResolves = await resolveValidPortalSignupInvitation(updated.token);
      expect(newTokenResolves).not.toBeNull();
      expect(newTokenResolves?.clientName).toBe(fixtures.clientA.name);

      const activities = await prisma.activity.findMany({
        where: { entityId: invitation.id, action: "PORTAL_INVITATION_RESENT" },
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].organizationId).toBe(fixtures.orgA.id);

      expect(sendEmailViaResend).toHaveBeenCalledTimes(1);
      const sentWith = sendEmailViaResend.mock.calls[0][0];
      expect(sentWith.to).toBe(invitation.email);
      expect(sentWith.html).toContain(encodeURIComponent(updated.token));
      expect(sentWith.html).not.toContain(encodeURIComponent(originalToken));

      // No duplicate ClientInvitation row and no unrelated account was
      // created by the resend.
      const invitationCount = await prisma.clientInvitation.count({ where: { clientId: fixtures.clientA.id, email: invitation.email } });
      expect(invitationCount).toBe(1);
      const portalUserCount = await prisma.portalUser.count({ where: { email: invitation.email } });
      expect(portalUserCount).toBe(0);

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });

    it("ADMIN (not just OWNER) can also resend", async () => {
      const invitation = await createClientInvitation(fixtures);
      actAs(fixtures.admin, fixtures.orgA.id);

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBeNull();
      const updated = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(updated.token).not.toBe(invitation.token);

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });
  });

  describe("B. authorization and isolation", () => {
    it("MEMBER cannot resend — rejected, the row is untouched, and no email is attempted", async () => {
      const invitation = await createClientInvitation(fixtures);
      actAs(fixtures.member, fixtures.orgA.id);

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBe("You don't have permission to manage client portal access.");
      const unchanged = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(unchanged.token).toBe(invitation.token);
      expect(sendEmailViaResend).not.toHaveBeenCalled();

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });

    it("an invitation belonging to another organization cannot be resent, and the row is untouched", async () => {
      const foreignInvitation = await createClientInvitation(fixtures, { clientId: fixtures.clientB.id });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await resendClientInvitationAction(foreignInvitation.id);

      expect(result.error).toBe("Invitation not found.");
      const unchanged = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: foreignInvitation.id } });
      expect(unchanged.token).toBe(foreignInvitation.token);
      expect(sendEmailViaResend).not.toHaveBeenCalled();

      await prisma.clientInvitation.delete({ where: { id: foreignInvitation.id } });
    });

    it("a nonexistent invitation id returns the identical message a foreign-organization id returns — no distinguishable response", async () => {
      const foreignInvitation = await createClientInvitation(fixtures, { clientId: fixtures.clientB.id });
      actAs(fixtures.owner, fixtures.orgA.id);

      const crossOrgResult = await resendClientInvitationAction(foreignInvitation.id);
      const nonexistentResult = await resendClientInvitationAction(randomUUID());

      expect(crossOrgResult.error).toBe(nonexistentResult.error);
      expect(nonexistentResult.error).toBe("Invitation not found.");

      await prisma.clientInvitation.delete({ where: { id: foreignInvitation.id } });
    });
  });

  describe("C. invitation states", () => {
    it("an ACCEPTED invitation is rejected, and the row (including its token) is left untouched", async () => {
      const invitation = await createClientInvitation(fixtures, { status: "ACCEPTED" });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBe("This invitation has already been accepted.");
      const unchanged = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(unchanged.token).toBe(invitation.token);
      expect(unchanged.status).toBe("ACCEPTED");
      expect(sendEmailViaResend).not.toHaveBeenCalled();

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });

    it("a REVOKED invitation succeeds and is revived to PENDING with a fresh token", async () => {
      const invitation = await createClientInvitation(fixtures, { status: "REVOKED" });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBeNull();
      const revived = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(revived.status).toBe("PENDING");
      expect(revived.token).not.toBe(invitation.token);

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });

    it("a PENDING invitation whose expiresAt has already passed (time-lapsed, never written as a literal EXPIRED status by any code path in this app) succeeds and gets a fresh future expiry", async () => {
      const invitation = await createClientInvitation(fixtures, {
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1000),
      });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBeNull();
      const revived = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(revived.expiresAt.getTime()).toBeGreaterThan(Date.now());

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });

    it("the schema's literal EXPIRED status value (not written by any current code path, but a seedable state the action does not special-case) is also revived to PENDING, same as REVOKED", async () => {
      const invitation = await createClientInvitation(fixtures, { status: "EXPIRED" });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBeNull();
      const revived = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(revived.status).toBe("PENDING");
      expect(revived.token).not.toBe(invitation.token);

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });
  });

  describe("D. email delivery failure", () => {
    it("when delivery fails, the token is already rotated and persisted, the old link is already dead, the result reports emailFailed, and a further resend remains possible", async () => {
      const invitation = await createClientInvitation(fixtures);
      const originalToken = invitation.token;
      sendEmailViaResend.mockResolvedValueOnce({ ok: false, reason: "provider_error" });
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBeNull();
      expect(result.emailFailed).toBe(true);
      expect(result.message).toBe("Invitation updated, but the email could not be sent.");
      expect(result.token).toBeDefined();

      // The new token is already saved even though delivery failed — the
      // DB write happens before the email call and is never rolled back.
      const afterFailure = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(afterFailure.token).toBe(result.token);
      expect(afterFailure.status).toBe("PENDING");

      // The OLD link is already dead, even though the recipient never
      // received the new one by email — only a staff member who copies
      // the link manually (the UI's own stated fallback) can share it.
      const oldTokenResolves = await resolveValidPortalSignupInvitation(originalToken);
      expect(oldTokenResolves).toBeNull();
      const newTokenResolves = await resolveValidPortalSignupInvitation(afterFailure.token);
      expect(newTokenResolves).not.toBeNull();

      // A further resend is still possible — the row is PENDING, not stuck.
      sendEmailViaResend.mockResolvedValueOnce({ ok: true });
      const secondResult = await resendClientInvitationAction(invitation.id);
      expect(secondResult.error).toBeNull();
      expect(secondResult.emailFailed).toBeUndefined();

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });
  });

  describe("E. rate limiting", () => {
    /**
     * The real in-memory limiter's own allow/block counting is globally
     * mocked away for every integration test (see this file's own header
     * comment and test/integration/setup-mocks.ts) — confirmed directly,
     * not assumed: even 8 consecutive real calls to checkRateLimit with an
     * identical key, run in isolation outside this suite's module graph,
     * never tripped RESEND_PORTAL_INVITE_LIMIT (5/hour). That counting
     * logic is exhaustively unit-tested elsewhere (per setup-mocks.ts's own
     * comment) and is explicitly out of scope for an integration test by
     * this codebase's own established convention. What IS verified here,
     * deterministically, is resendClientInvitationAction's own contract
     * with the limiter: which config and identifier it passes, and that it
     * correctly short-circuits (no token rotation, no email) when the
     * limiter reports `limited: true` — using this file's own local
     * override of @/lib/rate-limit, which takes precedence over the global
     * one for this file only and is restored to its own always-allow
     * default after every test, so no other test anywhere is affected.
     */
    it("passes the invitation's own id (never the actor or IP) as the rate-limit identifier", async () => {
      const invitation = await createClientInvitation(fixtures);
      actAs(fixtures.owner, fixtures.orgA.id);

      await resendClientInvitationAction(invitation.id);

      expect(checkRateLimit).toHaveBeenCalledTimes(1);
      const [config, identifier] = checkRateLimit.mock.calls[0];
      expect(config.scope).toBe("resend-portal-invite");
      expect(identifier).toBe(invitation.id);

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });

    it("when the limiter reports limited:true, the action returns the generic message and performs no token rotation or email send", async () => {
      const invitation = await createClientInvitation(fixtures);
      actAs(fixtures.owner, fixtures.orgA.id);
      checkRateLimit.mockReturnValueOnce({ limited: true, message: "Too many requests. Please try again later." });

      const result = await resendClientInvitationAction(invitation.id);

      expect(result.error).toBe("Too many requests. Please try again later.");
      const unchanged = await prisma.clientInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(unchanged.token).toBe(invitation.token);
      expect(sendEmailViaResend).not.toHaveBeenCalled();

      await prisma.clientInvitation.delete({ where: { id: invitation.id } });
    });

    it("the rate-limit check runs before the database lookup — a rate-limited call never even queries for the invitation, confirmed by rate-limiting a nonexistent id without it throwing a lookup-shaped error", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      checkRateLimit.mockReturnValueOnce({ limited: true, message: "Too many requests. Please try again later." });

      const result = await resendClientInvitationAction(randomUUID());

      expect(result.error).toBe("Too many requests. Please try again later.");
    });
  });
});
