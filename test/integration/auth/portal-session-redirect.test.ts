import { describe, expect, it } from "vitest";
import { redirectToPortalLoginForSessionLoss } from "@/lib/auth/portal-session-redirect";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Portal session-loss UX fix — the shared helper every Portal
 * session-loss guard (current-portal-user.ts, portal/(app)/layout.tsx)
 * now routes through instead of a bare redirect("/portal/login").
 * Mirrors test/integration/auth/staff-session-redirect.test.ts's own
 * coverage shape, plus the one Portal-specific case that sanitizer
 * exists for: a Staff route must never flow through as redirectTo, even
 * though it's a perfectly normal same-origin path on its own.
 */
function captureRedirect(run: () => void): RedirectSignal {
  try {
    run();
  } catch (err) {
    if (err instanceof RedirectSignal) return err;
    throw err;
  }
  throw new Error("expected redirectToPortalLoginForSessionLoss to redirect");
}

function parse(url: string): URL {
  return new URL(url, "http://localhost");
}

describe("redirectToPortalLoginForSessionLoss", () => {
  it("with no currentPath, redirects to /portal/login with only the session_expired reason", () => {
    const signal = captureRedirect(() => redirectToPortalLoginForSessionLoss());
    expect(signal.url).toBe("/portal/login?reason=session_expired");
  });

  it("preserves the Portal root", () => {
    const signal = captureRedirect(() => redirectToPortalLoginForSessionLoss("/portal"));
    const url = parse(signal.url);
    expect(url.pathname).toBe("/portal/login");
    expect(url.searchParams.get("reason")).toBe("session_expired");
    expect(url.searchParams.get("redirectTo")).toBe("/portal");
  });

  it("preserves a nested Portal route", () => {
    const signal = captureRedirect(() => redirectToPortalLoginForSessionLoss("/portal/quotes/abc-123"));
    const url = parse(signal.url);
    expect(url.searchParams.get("redirectTo")).toBe("/portal/quotes/abc-123");
  });

  it("rejects a Staff route, falling back to /portal — the one thing sanitizeRedirectPath alone would not catch", () => {
    const signal = captureRedirect(() => redirectToPortalLoginForSessionLoss("/dashboard"));
    const url = parse(signal.url);
    expect(url.searchParams.get("reason")).toBe("session_expired");
    expect(url.searchParams.get("redirectTo")).toBe("/portal");
  });

  it("rejects a Platform Admin route, falling back to /portal", () => {
    const signal = captureRedirect(() => redirectToPortalLoginForSessionLoss("/platform-admin"));
    const url = parse(signal.url);
    expect(url.searchParams.get("redirectTo")).toBe("/portal");
  });

  it("rejects an absolute external URL", () => {
    const signal = captureRedirect(() => redirectToPortalLoginForSessionLoss("https://evil.example"));
    const url = parse(signal.url);
    expect(url.searchParams.get("redirectTo")).toBe("/portal");
  });

  it("rejects a protocol-relative URL", () => {
    const signal = captureRedirect(() => redirectToPortalLoginForSessionLoss("//evil.example"));
    const url = parse(signal.url);
    expect(url.searchParams.get("redirectTo")).toBe("/portal");
  });

  it("falls back safely on malformed/non-path input", () => {
    const signal = captureRedirect(() => redirectToPortalLoginForSessionLoss("not-a-path"));
    const url = parse(signal.url);
    expect(url.searchParams.get("redirectTo")).toBe("/portal");
  });
});
