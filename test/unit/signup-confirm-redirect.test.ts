import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSignupConfirmRedirectTo } from "@/lib/auth/signup-confirm-redirect";

// Invited-signup defect fix, secondary half. Pure function — no Supabase/
// Prisma call happens inside it — proving in isolation that the
// invitation context (the `next` destination) is embedded correctly, and
// that the origin always comes from this app's own resolved base URL,
// never something request-derived.

describe("buildSignupConfirmRedirectTo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("standalone signup (no invitation): points at /auth/confirm?type=signup&next=/dashboard, using APP_BASE_URL", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildSignupConfirmRedirectTo(null);
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.aqenra.com");
    expect(parsed.pathname).toBe("/auth/confirm");
    expect(parsed.searchParams.get("type")).toBe("signup");
    expect(parsed.searchParams.get("next")).toBe("/dashboard");
  });

  it("invited signup: the next destination is /invite/<token>, preserving the invitation through email confirmation", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildSignupConfirmRedirectTo({ token: "abc-123", email: "member@example.com", organizationName: "Acme" });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.aqenra.com");
    expect(parsed.searchParams.get("type")).toBe("signup");
    expect(parsed.searchParams.get("next")).toBe("/invite/abc-123");
  });

  it("never uses a request-derived or arbitrary host — falls back to this app's own resolved base URL (VERCEL_URL)", () => {
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("VERCEL_URL", "some-preview-xyz.vercel.app");
    const url = buildSignupConfirmRedirectTo(null);
    expect(new URL(url).origin).toBe("https://some-preview-xyz.vercel.app");
  });

  it("the resulting URL's own origin is always this app's own base URL, regardless of the invitation token's shape — never something an attacker-controlled token could redirect elsewhere", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildSignupConfirmRedirectTo({
      token: "https://evil.example.com",
      email: "member@example.com",
      organizationName: "Acme",
    });
    // Even a token shaped like a full external URL can only ever become a
    // *path segment* under this app's own /invite/ route — sanitizeRedirectPath
    // still requires the final `next` value to start with a single leading
    // slash, so it is folded into the path rather than replacing the origin.
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.aqenra.com");
    expect(parsed.hostname).toBe("app.aqenra.com");
  });
});
