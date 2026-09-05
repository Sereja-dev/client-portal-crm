import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPortalSignupConfirmationUrl } from "@/lib/auth/portal-signup-confirm-redirect";

// Portal signup-confirmation defect fix. Pure function — no Supabase/
// Resend call happens inside it — proving in isolation that the complete
// Portal confirmation URL (never Supabase's own native email/hosted
// verify flow) carries a real token_hash, the distinct portal_signup
// type (never plain "signup" — see src/app/auth/confirm/route.ts's own
// doc comment on why this matters), and the invitation context, always
// on this app's own resolved origin.

describe("buildPortalSignupConfirmationUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("standalone Portal signup (no invitation): token_hash + type=portal_signup + next=/portal, on APP_BASE_URL", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildPortalSignupConfirmationUrl({ tokenHash: "real-hash-value", invitation: null });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.aqenra.com");
    expect(parsed.pathname).toBe("/auth/confirm");
    expect(parsed.searchParams.get("token_hash")).toBe("real-hash-value");
    expect(parsed.searchParams.get("type")).toBe("portal_signup");
    expect(parsed.searchParams.get("next")).toBe("/portal");
  });

  it("invited Portal signup: next is /portal/invite/<token>, preserving the invitation through email confirmation", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildPortalSignupConfirmationUrl({
      tokenHash: "real-hash-value",
      invitation: { token: "abc-123", email: "client@example.com", clientName: "Acme" },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("token_hash")).toBe("real-hash-value");
    expect(parsed.searchParams.get("type")).toBe("portal_signup");
    expect(parsed.searchParams.get("next")).toBe("/portal/invite/abc-123");
  });

  it("the type value is always portal_signup, never plain signup — this is what keeps a Portal confirmation from ever reaching Staff provisioning logic", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildPortalSignupConfirmationUrl({ tokenHash: "h", invitation: null });
    expect(new URL(url).searchParams.get("type")).not.toBe("signup");
  });

  it("never uses a request-derived or arbitrary host — falls back to this app's own resolved base URL (VERCEL_URL)", () => {
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("VERCEL_URL", "some-preview-xyz.vercel.app");
    const url = buildPortalSignupConfirmationUrl({ tokenHash: "h", invitation: null });
    expect(new URL(url).origin).toBe("https://some-preview-xyz.vercel.app");
  });

  it("the resulting URL's own origin is always this app's own base URL, regardless of the invitation token's shape", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildPortalSignupConfirmationUrl({
      tokenHash: "h",
      invitation: { token: "https://evil.example.com", email: "client@example.com", clientName: "Acme" },
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.aqenra.com");
    expect(parsed.hostname).toBe("app.aqenra.com");
  });
});
