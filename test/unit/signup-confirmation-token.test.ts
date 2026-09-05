import { describe, expect, it, vi } from "vitest";

// src/lib/auth/signup-confirmation-token.ts imports the real "server-only"
// marker package — see test/unit/recovery-token.test.ts's own header
// comment for why this needs neutralizing here rather than disabling the
// guard globally.
vi.mock("server-only", () => ({}));

const generateLinkMock = vi.fn();
vi.mock("@/lib/supabase/admin-client", () => ({
  getSupabaseAuthAdminClient: () => ({
    auth: { admin: { generateLink: generateLinkMock } },
  }),
}));

const { generateSignupConfirmationToken } = await import("@/lib/auth/signup-confirmation-token");

// Signup-confirmation defect fix (Invited Signup Confirmation Redirect
// Investigation). Proves generateSignupConfirmationToken() never calls
// supabase.auth.signUp() (there is no such call anywhere in this module —
// only admin.generateLink()), extracts hashed_token correctly, and
// classifies alreadyConfirmed from the real field names the installed SDK
// documents on the returned user object.

describe("generateSignupConfirmationToken", () => {
  it("calls generateLink with type: signup, the given email/password, and no organizationName by default", async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: { properties: { hashed_token: "hash-abc" }, user: { id: "u1", email: "a@example.com" } },
      error: null,
    });

    const result = await generateSignupConfirmationToken({ email: "a@example.com", password: "correct-horse" });

    expect(generateLinkMock).toHaveBeenCalledWith({
      type: "signup",
      email: "a@example.com",
      password: "correct-horse",
      options: undefined,
    });
    expect(result).toEqual({ ok: true, tokenHash: "hash-abc", alreadyConfirmed: false });
  });

  it("passes organizationName through as user_metadata (options.data) only when provided", async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: { properties: { hashed_token: "hash-def" }, user: { id: "u2", email: "b@example.com" } },
      error: null,
    });

    await generateSignupConfirmationToken({ email: "b@example.com", password: "x", organizationName: "Acme Inc." });

    expect(generateLinkMock).toHaveBeenCalledWith({
      type: "signup",
      email: "b@example.com",
      password: "x",
      options: { data: { organizationName: "Acme Inc." } },
    });
  });

  it("classifies alreadyConfirmed: true when the returned user has email_confirmed_at set", async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: {
        properties: { hashed_token: "hash-ghi" },
        user: { id: "u3", email: "c@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" },
      },
      error: null,
    });

    const result = await generateSignupConfirmationToken({ email: "c@example.com", password: "x" });
    expect(result).toEqual({ ok: true, tokenHash: "hash-ghi", alreadyConfirmed: true });
  });

  it("classifies alreadyConfirmed: true when only confirmed_at (not email_confirmed_at) is set", async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: {
        properties: { hashed_token: "hash-jkl" },
        user: { id: "u4", email: "d@example.com", confirmed_at: "2026-01-01T00:00:00Z" },
      },
      error: null,
    });

    const result = await generateSignupConfirmationToken({ email: "d@example.com", password: "x" });
    expect(result.ok && result.alreadyConfirmed).toBe(true);
  });

  it("passes through Supabase's own rejection message (e.g. an existing, already-confirmed email)", async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: { properties: null, user: null },
      error: { message: "User already registered" },
    });

    const result = await generateSignupConfirmationToken({ email: "dup@example.com", password: "x" });
    expect(result).toEqual({ ok: false, error: "User already registered" });
  });

  it("never surfaces a raw exception — an unexpected throw becomes a generic, safe error", async () => {
    generateLinkMock.mockRejectedValueOnce(new Error("network exploded"));

    const result = await generateSignupConfirmationToken({ email: "e@example.com", password: "x" });
    expect(result).toEqual({ ok: false, error: "Unable to create your account. Please try again." });
  });

  it("a malformed success response (no hashed_token) is treated as a failure, never a crash", async () => {
    generateLinkMock.mockResolvedValueOnce({ data: { properties: {}, user: { id: "u5" } }, error: null });

    const result = await generateSignupConfirmationToken({ email: "f@example.com", password: "x" });
    expect(result.ok).toBe(false);
  });
});
