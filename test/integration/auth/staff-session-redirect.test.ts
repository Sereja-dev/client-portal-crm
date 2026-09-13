import { describe, expect, it } from "vitest";
import { redirectToLoginForSessionLoss } from "@/lib/auth/staff-session-redirect";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Staff session-loss UX fix — the shared helper every Staff session-loss
 * guard (current-user.ts, (dashboard)/layout.tsx, platform-admin/
 * authorization.ts) now routes through instead of a bare
 * redirect("/login"). Covers exactly what the task's own audit asked
 * for: safe internal paths are preserved, external/protocol-relative/
 * malformed input falls back safely (reusing sanitizeRedirectPath()'s
 * own already-exhaustive coverage in test/unit/safe-redirect.test.ts —
 * not duplicated here), and the session_expired reason is always
 * present.
 */
function captureRedirect(run: () => void): RedirectSignal {
  try {
    run();
  } catch (err) {
    if (err instanceof RedirectSignal) return err;
    throw err;
  }
  throw new Error("expected redirectToLoginForSessionLoss to redirect");
}

function parse(url: string): URL {
  return new URL(url, "http://localhost");
}

describe("redirectToLoginForSessionLoss", () => {
  it("with no currentPath, redirects to /login with only the session_expired reason — the safe fallback for a generic guard with no reliable path to recover", () => {
    const signal = captureRedirect(() => redirectToLoginForSessionLoss());
    expect(signal.url).toBe("/login?reason=session_expired");
  });

  it("preserves a safe internal path as redirectTo", () => {
    const signal = captureRedirect(() => redirectToLoginForSessionLoss("/clients/abc-123/edit"));
    const url = parse(signal.url);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("reason")).toBe("session_expired");
    expect(url.searchParams.get("redirectTo")).toBe("/clients/abc-123/edit");
  });

  it("preserves a path that includes a query string", () => {
    const signal = captureRedirect(() => redirectToLoginForSessionLoss("/clients?status=active"));
    const url = parse(signal.url);
    expect(url.searchParams.get("redirectTo")).toBe("/clients?status=active");
  });

  it("rejects an absolute external URL, falling back to the login flow's own default landing route", () => {
    const signal = captureRedirect(() => redirectToLoginForSessionLoss("https://evil.example"));
    const url = parse(signal.url);
    expect(url.searchParams.get("reason")).toBe("session_expired");
    expect(url.searchParams.get("redirectTo")).toBe("/dashboard");
  });

  it("rejects a protocol-relative URL", () => {
    const signal = captureRedirect(() => redirectToLoginForSessionLoss("//evil.example"));
    const url = parse(signal.url);
    expect(url.searchParams.get("redirectTo")).toBe("/dashboard");
  });

  it("falls back safely on malformed/non-path input", () => {
    const signal = captureRedirect(() => redirectToLoginForSessionLoss("not-a-path"));
    const url = parse(signal.url);
    expect(url.searchParams.get("redirectTo")).toBe("/dashboard");
  });
});
