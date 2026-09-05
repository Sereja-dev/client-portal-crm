import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSignupConfirmationUrl } from "@/lib/auth/signup-confirm-redirect";

// Signup-confirmation defect fix (Invited Signup Confirmation Redirect
// Investigation). Pure function — no Supabase/Resend call happens inside
// it — proving in isolation that the complete confirmation URL this
// app's own branded email links to (never Supabase's own native email/
// hosted verify flow) carries a real token_hash, the correct type, and
// the invitation context, always on this app's own resolved origin.

describe("buildSignupConfirmationUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("standalone signup (no invitation): token_hash + type=signup + next=/dashboard, on APP_BASE_URL", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildSignupConfirmationUrl({ tokenHash: "real-hash-value", invitation: null });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.aqenra.com");
    expect(parsed.pathname).toBe("/auth/confirm");
    expect(parsed.searchParams.get("token_hash")).toBe("real-hash-value");
    expect(parsed.searchParams.get("type")).toBe("signup");
    expect(parsed.searchParams.get("next")).toBe("/dashboard");
  });

  it("invited signup: next is /invite/<token>, preserving the invitation through email confirmation", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildSignupConfirmationUrl({
      tokenHash: "real-hash-value",
      invitation: { token: "abc-123", email: "member@example.com", organizationName: "Acme" },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("token_hash")).toBe("real-hash-value");
    expect(parsed.searchParams.get("type")).toBe("signup");
    expect(parsed.searchParams.get("next")).toBe("/invite/abc-123");
  });

  it("never uses a request-derived or arbitrary host — falls back to this app's own resolved base URL (VERCEL_URL)", () => {
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("VERCEL_URL", "some-preview-xyz.vercel.app");
    const url = buildSignupConfirmationUrl({ tokenHash: "h", invitation: null });
    expect(new URL(url).origin).toBe("https://some-preview-xyz.vercel.app");
  });

  it("the resulting URL's own origin is always this app's own base URL, regardless of the invitation token's shape", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.aqenra.com");
    const url = buildSignupConfirmationUrl({
      tokenHash: "h",
      invitation: { token: "https://evil.example.com", email: "member@example.com", organizationName: "Acme" },
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.aqenra.com");
    expect(parsed.hostname).toBe("app.aqenra.com");
  });
});
