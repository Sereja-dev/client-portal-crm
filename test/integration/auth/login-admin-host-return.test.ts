import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { login } from "@/app/(auth)/login/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockSignInConfig, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

/**
 * Platform Admin dedicated hostname — login submission evidence (reviewer
 * Finding 2). Calls the real, unmodified `login` Server Action
 * (src/app/(auth)/login/actions.ts) directly, through the same
 * MockSignInConfig seam test/integration/portal/login.test.ts already
 * established for supabase.auth.signInWithPassword() — a controlled,
 * local, deterministic stand-in for Supabase's own response, never a real
 * external account, credential or network call. sanitizeRedirectPath()
 * (src/lib/safe-redirect.ts) is the real, unmodified function, exercised
 * exactly as the real action calls it.
 *
 * SCOPE, STATED HONESTLY (do not read more into this than it proves):
 * - Real application code exercised: the `login` Server Action, end to
 *   end, including sanitizeRedirectPath() and withToast().
 * - Simulated: supabase.auth.signInWithPassword()'s own response — a
 *   local, one-shot MockSignInConfig, not a real Supabase Auth call and
 *   not real credentials.
 * - NOT exercised here at all: the admin.aqenra.com hostname. A Server
 *   Action has no concept of the request's own Host — that layer is
 *   covered separately, with the REAL middleware and a real browser, by
 *   test/e2e/platform-admin-host-routing.spec.ts ("anonymous admin-host
 *   visitor reaches the login form..." and "an already-authorized-admin
 *   session... is carried through / to /platform-admin").
 * - NOT exercised here: requirePlatformAdmin()'s own allow/deny decision —
 *   this action has no awareness of Platform Admin authorization at all
 *   (see the third test below); that decision is covered exhaustively by
 *   test/integration/platform-admin/execution-authorization.test.ts and by
 *   this same E2E suite's "a signed-in non-admin... is denied".
 *
 * Together with those two suites, this closes the one remaining untested
 * segment of the full chain (form submit -> real action -> a controlled
 * auth outcome -> real redirect validation) without ever claiming a real
 * Supabase provider or a real hostname was involved here.
 */
function loginForm(fields: { email: string; password?: string; redirectTo?: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", fields.password ?? "correct-horse-battery-staple");
  if (fields.redirectTo) formData.set("redirectTo", fields.redirectTo);
  return formData;
}

const PLATFORM_ADMIN_TEST_EMAIL = "platform-admin-login-return-test@example.com";
const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

async function expectRedirectTo(action: Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await action;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

describe("login — real Server Action, controlled Supabase response, the /platform-admin return path", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_TEST_EMAIL;
  });

  afterEach(() => {
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
    await cleanupTestData(fixtures);
  });

  it("a successful simulated auth response, with redirectTo=/platform-admin, redirects there", async () => {
    setMockSignInConfig({ kind: "success", user: { id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL } });

    const redirect = await expectRedirectTo(
      login({ error: null }, loginForm({ email: PLATFORM_ADMIN_TEST_EMAIL, redirectTo: "/platform-admin" })),
    );
    expect(redirect.url).toContain("/platform-admin");
  });

  it("a failed simulated auth response never redirects and stays in the login flow", async () => {
    setMockSignInConfig({ kind: "error", message: "Invalid login credentials" });

    const result = await login(
      { error: null },
      loginForm({ email: PLATFORM_ADMIN_TEST_EMAIL, redirectTo: "/platform-admin" }),
    );

    expect(result.error).toBe("Invalid login credentials");
  });

  it("a successful auth response for a non-admin identity still only follows redirectTo — this action has no Platform Admin authorization concept at all", async () => {
    setMockSignInConfig({ kind: "success", user: { id: fixtures.owner.id, email: fixtures.owner.email } });

    // The action redirects wherever a validly-shaped redirectTo points,
    // for ANY identity — it is requirePlatformAdmin(), on the NEXT request
    // to /platform-admin, that actually denies a non-admin (proven
    // separately; see this file's own header comment).
    const redirect = await expectRedirectTo(
      login({ error: null }, loginForm({ email: fixtures.owner.email, redirectTo: "/platform-admin" })),
    );
    expect(redirect.url).toContain("/platform-admin");
  });

  it("an absolute external redirectTo is rejected by the existing, unmodified sanitizeRedirectPath — falls back to /dashboard, never follows the attacker's URL", async () => {
    setMockSignInConfig({ kind: "success", user: { id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL } });

    const redirect = await expectRedirectTo(
      login({ error: null }, loginForm({ email: PLATFORM_ADMIN_TEST_EMAIL, redirectTo: "https://evil.example" })),
    );
    expect(redirect.url).not.toContain("evil.example");
    expect(redirect.url).toContain("/dashboard");
  });

  it("a protocol-relative redirectTo (//evil.example) is rejected the same way", async () => {
    setMockSignInConfig({ kind: "success", user: { id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL } });

    const redirect = await expectRedirectTo(
      login({ error: null }, loginForm({ email: PLATFORM_ADMIN_TEST_EMAIL, redirectTo: "//evil.example" })),
    );
    expect(redirect.url).not.toContain("evil.example");
    expect(redirect.url).toContain("/dashboard");
  });

  it("a backslash-variant redirectTo (/\\evil.example) is rejected the same way", async () => {
    setMockSignInConfig({ kind: "success", user: { id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL } });

    const redirect = await expectRedirectTo(
      login({ error: null }, loginForm({ email: PLATFORM_ADMIN_TEST_EMAIL, redirectTo: "/\\evil.example" })),
    );
    expect(redirect.url).not.toContain("evil.example");
    expect(redirect.url).toContain("/dashboard");
  });
});
