import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { signup } from "@/app/(auth)/signup/actions";
import { GET as confirmGet } from "@/app/auth/confirm/route";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { setMockVerifyOtpConfig, resetAuthMock } from "../../support/auth-mock";
import { resetNavigationMock } from "../../support/navigation-mock";

// Signup-confirmation defect fix (Invited Signup Confirmation Redirect
// Investigation) — the exact end-to-end shape the real Production defect
// broke, and the previous test suite never modeled: signup() generates a
// confirmation token and hands the resulting URL to (a fake standing in
// for) Resend; THIS test recovers that exact URL, parses it exactly like
// a real browser would after a real click, and feeds its query parameters
// into the REAL /auth/confirm Route Handler — proving the full chain
// (token generation -> emailed URL -> route's own query-param reading ->
// verifyOtp -> redirect) actually agrees end to end, not just that each
// piece is independently well-formed. If a future change ever dropped
// `token_hash` from the emailed URL, or the route silently stopped
// reading it, this test's own `parsed.searchParams.get("token_hash")`
// assertion (never optional-chained away) fails loudly — this is
// precisely the class of gap that let the real Production bug through.
//
// Does not require live Supabase or Resend network access: generateToken
// is injected (never a real Admin API call), and the route's own
// verifyOtp() call goes through the shared, globally-mocked
// @/lib/supabase/server client (test/integration/setup-mocks.ts),
// configured per test via setMockVerifyOtpConfig() — the same DI/mock
// seams every other integration test in this suite already uses.

function signupForm(fields: { email: string; password: string; invitationToken?: string; organizationName?: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", fields.password);
  formData.set("confirmPassword", fields.password);
  if (fields.invitationToken) formData.set("invitationToken", fields.invitationToken);
  if (fields.organizationName) formData.set("organizationName", fields.organizationName);
  return formData;
}

describe("signup confirmation — real end-to-end shape (token generation -> emailed URL -> /auth/confirm -> verifyOtp -> redirect)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("invited signup, confirmation required: the emailed URL's token_hash/type/next survive intact into a real /auth/confirm request, which redirects to /invite/<token> exactly", async () => {
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: fixtures.orgA.id,
        email: testEmail(`e2e-invited-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId),
        role: Role.MEMBER,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });

    let capturedConfirmUrl: string | undefined;
    const result = await signup(
      { error: null },
      signupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token }),
      {
        generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "e2e-real-token-hash", alreadyConfirmed: false }),
        sendConfirmationEmail: vi.fn().mockImplementation(async (params: { confirmUrl: string }) => {
          capturedConfirmUrl = params.confirmUrl;
          return { delivered: true };
        }),
      },
    );
    expect(result.message).toMatch(/check your email/i);
    expect(capturedConfirmUrl).toBeDefined();

    // Exactly what a real user's browser would carry after clicking the
    // emailed link — parsed from the real URL this action produced, never
    // hand-constructed here.
    const parsed = new URL(capturedConfirmUrl!);
    const tokenHash = parsed.searchParams.get("token_hash");
    const type = parsed.searchParams.get("type");
    const next = parsed.searchParams.get("next");
    expect(tokenHash).toBe("e2e-real-token-hash");
    expect(type).toBe("signup");
    expect(next).toBe(`/invite/${invitation.token}`);

    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email: invitation.email } });

    // The real route uses NextResponse.redirect (a real Response), not
    // next/navigation's redirect() — it returns rather than throws.
    const confirmRequest = new Request(`http://localhost${parsed.pathname}${parsed.search}`);
    const response = await confirmGet(confirmRequest);
    expect(response.headers.get("location")).toBe(`http://localhost/invite/${invitation.token}`);

    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("standalone signup, confirmation required: next=/dashboard survives into a real /auth/confirm request, and organizationName (carried through user_metadata) provisions the intended organization exactly once", async () => {
    const email = testEmail(`e2e-standalone-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const organizationName = `E2E Standalone Co ${randomUUID().slice(0, 8)}`;

    let capturedConfirmUrl: string | undefined;
    const result = await signup(
      { error: null },
      signupForm({ email, password: "correct-horse-battery-1", organizationName }),
      {
        generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "e2e-standalone-hash", alreadyConfirmed: false }),
        sendConfirmationEmail: vi.fn().mockImplementation(async (params: { confirmUrl: string }) => {
          capturedConfirmUrl = params.confirmUrl;
          return { delivered: true };
        }),
      },
    );
    expect(result.message).toMatch(/check your email/i);

    const parsed = new URL(capturedConfirmUrl!);
    expect(parsed.searchParams.get("token_hash")).toBe("e2e-standalone-hash");
    expect(parsed.searchParams.get("type")).toBe("signup");
    expect(parsed.searchParams.get("next")).toBe("/dashboard");

    const userId = randomUUID();
    // The real route's own getOrCreateUser() reads user_metadata off the
    // verifyOtp() response — the organizationName the form was submitted
    // with, round-tripped through Supabase's own user record, never a
    // query parameter.
    setMockVerifyOtpConfig({
      kind: "success",
      user: { id: userId, email, user_metadata: { organizationName } },
    });

    const response = await confirmGet(new Request(`http://localhost${parsed.pathname}${parsed.search}`));
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.email).toBe(email);

    const membership = await prisma.membership.findFirst({ where: { userId, role: "OWNER" } });
    expect(membership).not.toBeNull();
    const organization = await prisma.organization.findUnique({ where: { id: membership!.organizationId } });
    expect(organization?.name).toBe(organizationName);

    await prisma.organization.deleteMany({ where: { id: membership!.organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("a missing token_hash on the confirm request fails safely to /signup?invalid=1 — proving the route cannot silently proceed without it", async () => {
    const response = await confirmGet(new Request("http://localhost/auth/confirm?type=signup&next=%2Fdashboard"));
    expect(response.headers.get("location")).toBe("http://localhost/signup?invalid=1");
  });

  it("verifyOtp rejecting the token (invalid/expired/already-used) fails safely to /signup?invalid=1, never a redirect to next", async () => {
    setMockVerifyOtpConfig({ kind: "error", message: "Token has expired or is invalid" });
    const response = await confirmGet(
      new Request("http://localhost/auth/confirm?token_hash=stale&type=signup&next=%2Fdashboard"),
    );
    expect(response.headers.get("location")).toBe("http://localhost/signup?invalid=1");
  });
});
