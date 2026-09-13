import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { signOut } from "@/app/(dashboard)/actions";
import { portalSignOut } from "@/app/portal/(app)/actions";
import { portalLogin } from "@/app/portal/login/actions";
import { signOutForInviteAction } from "@/app/invite/[token]/actions";
import { signOutForPortalInviteAction } from "@/app/portal/invite/[token]/actions";
import { signOutAndGoToLogin } from "@/app/(auth)/reset-password/actions";
import { signOutAndGoToPortalLogin } from "@/app/portal/reset-password/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock, getMockSignOutCalls, setMockSignInConfig } from "../../support/auth-mock";
import { RedirectSignal, getNavigationCalls, resetNavigationMock } from "../../support/navigation-mock";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";

/**
 * Sign-out scope hardening. Proves the exact `scope` argument each real,
 * unmodified Server Action passes to supabase.auth.signOut() — not just
 * that signOut ran (which "local" and the library's "global" default are
 * otherwise indistinguishable behind). See the sign-out scope audit for
 * the full call-site-by-call-site rationale.
 *
 * What this file CANNOT prove: the actual server-side, cross-device
 * revocation difference between `local` and `global` — that's a real
 * network call to Supabase Auth's own `/logout?scope=...` endpoint
 * (verified directly against the installed @supabase/auth-js source
 * during the audit), which this mocked integration harness has no way to
 * exercise. This suite proves the app asks for the right scope; the
 * installed Supabase Auth client's own documented contract (and a later
 * Production smoke check) is what backs the actual multi-session
 * behavior.
 */

function loginForm(fields: { email: string; password?: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", fields.password ?? "correct-horse-battery-staple");
  return formData;
}

describe("Sign-out scope hardening", () => {
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

  it("Staff logout: signOut({ scope: 'local' }), redirect to /login unchanged", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);

    await expect(signOut()).rejects.toBeInstanceOf(RedirectSignal);

    expect(getMockSignOutCalls()).toEqual([{ scope: "local" }]);
    expect(getNavigationCalls()).toEqual([{ type: "redirect", url: "/login" }]);
  });

  it("Portal logout: signOut({ scope: 'local' }), redirect to /portal/login unchanged", async () => {
    actAs({ id: fixtures.portalUser.id, email: fixtures.portalUser.email }, fixtures.orgA.id);

    await expect(portalSignOut()).rejects.toBeInstanceOf(RedirectSignal);

    expect(getMockSignOutCalls()).toEqual([{ scope: "local" }]);
    expect(getNavigationCalls()).toEqual([{ type: "redirect", url: "/portal/login" }]);
  });

  it("Portal login unusable-session cleanup: signOut({ scope: 'local' }), same generic error unchanged", async () => {
    // Mirrors test/integration/portal/login.test.ts's own "stranded"
    // identity: authenticated via Supabase, but neither a PortalUser nor
    // a staff Membership row exists for this auth id.
    const strandedAuthId = randomUUID();
    const strandedEmail = testEmail(`signout-scope-stranded-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId);
    setMockSignInConfig({ kind: "success", user: { id: strandedAuthId, email: strandedEmail } });

    const result = await portalLogin({ error: null }, loginForm({ email: strandedEmail }));

    expect(result.error).toBe("This account does not have Client Portal access.");
    expect(getMockSignOutCalls()).toEqual([{ scope: "local" }]);
  });

  it("Staff invite identity switch: signOut({ scope: 'local' }), redirectTo/token preserved", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const token = randomUUID();

    await expect(signOutForInviteAction(token)).rejects.toBeInstanceOf(RedirectSignal);

    expect(getMockSignOutCalls()).toEqual([{ scope: "local" }]);
    expect(getNavigationCalls()).toEqual([
      { type: "redirect", url: `/login?redirectTo=${encodeURIComponent(`/invite/${token}`)}` },
    ]);
  });

  it("Portal invite identity switch: signOut({ scope: 'local' }), redirectTo/token preserved", async () => {
    actAs({ id: fixtures.portalUser.id, email: fixtures.portalUser.email }, fixtures.orgA.id);
    const token = randomUUID();

    await expect(signOutForPortalInviteAction(token)).rejects.toBeInstanceOf(RedirectSignal);

    expect(getMockSignOutCalls()).toEqual([{ scope: "local" }]);
    expect(getNavigationCalls()).toEqual([
      { type: "redirect", url: `/portal/login?redirectTo=${encodeURIComponent(`/portal/invite/${token}`)}` },
    ]);
  });

  describe("Password reset — deliberately NOT narrowed (regression guard)", () => {
    it("staff: signOutAndGoToLogin still calls signOut() with no explicit scope (library default, global)", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);

      await expect(signOutAndGoToLogin()).rejects.toBeInstanceOf(RedirectSignal);

      // No `scope` key at all — i.e. the call site passes no options
      // object, exactly as before this hardening. If a future edit ever
      // narrows this to `{ scope: "local" }`, this assertion fails.
      expect(getMockSignOutCalls()).toEqual([{}]);
      expect(getNavigationCalls()).toEqual([{ type: "redirect", url: "/login" }]);
    });

    it("portal: signOutAndGoToPortalLogin still calls signOut() with no explicit scope (library default, global)", async () => {
      actAs({ id: fixtures.portalUser.id, email: fixtures.portalUser.email }, fixtures.orgA.id);

      await expect(signOutAndGoToPortalLogin()).rejects.toBeInstanceOf(RedirectSignal);

      expect(getMockSignOutCalls()).toEqual([{}]);
      expect(getNavigationCalls()).toEqual([{ type: "redirect", url: "/portal/login" }]);
    });
  });
});
