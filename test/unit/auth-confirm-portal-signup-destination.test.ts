import { describe, expect, it, vi } from "vitest";

// src/app/auth/confirm/route.ts imports src/lib/auth/recovery-token.ts,
// which imports the real "server-only" marker package — see
// test/integration/auth/password-reset-confirm-route.test.ts's own header
// comment for why this needs neutralizing here rather than disabling the
// guard globally.
vi.mock("server-only", () => ({}));

const { resolvePortalSignupConfirmDestination } = await import("@/app/auth/confirm/route");

// Portal signup-confirmation defect fix. Pure — no Supabase/Prisma call
// happens inside it — proving in isolation that the `next` param this
// route receives for a Portal-originated confirmation can only ever
// resolve to a same-origin /portal path, never an open redirect and
// never a Staff-only path.

describe("resolvePortalSignupConfirmDestination", () => {
  it("preserves a valid same-origin invitation path", () => {
    expect(resolvePortalSignupConfirmDestination("/portal/invite/abc-123")).toBe("/portal/invite/abc-123");
  });

  it("falls back to /portal when next is absent", () => {
    expect(resolvePortalSignupConfirmDestination(null)).toBe("/portal");
  });

  it("rejects an absolute external URL — never an open redirect", () => {
    expect(resolvePortalSignupConfirmDestination("https://evil.example.com/phish")).toBe("/portal");
  });

  it("rejects a protocol-relative URL", () => {
    expect(resolvePortalSignupConfirmDestination("//evil.example.com")).toBe("/portal");
  });

  it("rejects a Staff-only path, even though it's a valid same-origin path — a Portal confirmation must never redirect into /dashboard", () => {
    expect(resolvePortalSignupConfirmDestination("/dashboard")).toBe("/portal");
  });

  it("rejects embedded CRLF", () => {
    expect(resolvePortalSignupConfirmDestination("/portal/invite/abc\r\nSet-Cookie: x=1")).toBe("/portal");
  });
});
