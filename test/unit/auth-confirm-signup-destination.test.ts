import { describe, expect, it, vi } from "vitest";

// src/app/auth/confirm/route.ts imports src/lib/auth/recovery-token.ts,
// which imports the real "server-only" marker package — see
// test/integration/auth/password-reset-confirm-route.test.ts's own header
// comment for why this needs neutralizing here rather than disabling the
// guard globally.
vi.mock("server-only", () => ({}));

const { resolveSignupConfirmDestination } = await import("@/app/auth/confirm/route");

// Invited-signup defect fix, secondary half. Pure — no Supabase/Prisma
// call happens inside it — proving in isolation that the `next` param
// this route receives (built only by this app's own buildSignupConfirmRedirectTo,
// but re-sanitized here regardless, on its own merits) can never become
// an open redirect.

describe("resolveSignupConfirmDestination", () => {
  it("preserves a valid same-origin invitation path", () => {
    expect(resolveSignupConfirmDestination("/invite/abc-123")).toBe("/invite/abc-123");
  });

  it("falls back to /dashboard when next is absent", () => {
    expect(resolveSignupConfirmDestination(null)).toBe("/dashboard");
  });

  it("rejects an absolute external URL — never an open redirect", () => {
    expect(resolveSignupConfirmDestination("https://evil.example.com/phish")).toBe("/dashboard");
  });

  it("rejects a protocol-relative URL", () => {
    expect(resolveSignupConfirmDestination("//evil.example.com")).toBe("/dashboard");
  });

  it("rejects embedded CRLF", () => {
    expect(resolveSignupConfirmDestination("/invite/abc\r\nSet-Cookie: x=1")).toBe("/dashboard");
  });
});
