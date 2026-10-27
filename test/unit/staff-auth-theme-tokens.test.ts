import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Accessibility Improvement A4, updated for Pre-Auth Redesign Slice A —
 * a lightweight source-contract test (same "read the real file as text"
 * approach design-system-foundation-tokens.test.ts/dark-mode-text-muted-
 * contrast.test.ts/form-control-accessibility-tokens.test.ts already
 * established) confirming the Staff Auth files use the app's own
 * semantic tokens, never a literal theme-invariant Tailwind color class.
 *
 * Product decision (Slice A): Staff pre-auth is now a FIXED dark shell,
 * independent of `data-theme` — see globals.css's own `.auth-shell` doc
 * comment. This file's own job is unchanged from A4's original intent
 * (no literal color classes, semantic tokens only) — it does not itself
 * assert computed color *values* (that remains test/e2e/staff-auth-
 * theme.spec.ts's job, now rewritten for the fixed-dark contract).
 *
 * Slice A also closed the two findings this suite's own A4 predecessor
 * deliberately left deferred (reset-password's invalid-link paragraph/
 * link colors, login's session-expired banner) — so, unlike the A4
 * version of this file, there is no longer anything to assert as
 * "intentionally untouched."
 */

const AUTH_SHELL = readFileSync(join(__dirname, "../../src/components/auth/auth-shell.tsx"), "utf-8");
const LOGIN_FORM = readFileSync(join(__dirname, "../../src/app/(auth)/login/login-form.tsx"), "utf-8");
const SIGNUP_FORM = readFileSync(join(__dirname, "../../src/app/(auth)/signup/signup-form.tsx"), "utf-8");
const LOGIN_PAGE = readFileSync(join(__dirname, "../../src/app/(auth)/login/page.tsx"), "utf-8");
const SIGNUP_PAGE = readFileSync(join(__dirname, "../../src/app/(auth)/signup/page.tsx"), "utf-8");
const FORGOT_PASSWORD_PAGE = readFileSync(join(__dirname, "../../src/app/(auth)/forgot-password/page.tsx"), "utf-8");
const RESET_PASSWORD_PAGE = readFileSync(join(__dirname, "../../src/app/(auth)/reset-password/page.tsx"), "utf-8");
const ROOT_PAGE = readFileSync(join(__dirname, "../../src/app/page.tsx"), "utf-8");
const INVITE_PAGE = readFileSync(join(__dirname, "../../src/app/invite/[token]/page.tsx"), "utf-8");
const ORG_UNAVAILABLE_PAGE = readFileSync(join(__dirname, "../../src/app/organization-unavailable/page.tsx"), "utf-8");
const AUTH_ERROR = readFileSync(join(__dirname, "../../src/app/(auth)/error.tsx"), "utf-8");
const ACCEPT_INVITATION_FORM = readFileSync(join(__dirname, "../../src/components/invite/accept-invitation-form.tsx"), "utf-8");

// Extracts every <h1 className="...">'s own class string.
function headingClassStrings(source: string): string[] {
  return [...source.matchAll(/<h1\s+className="([^"]*)"/g)].map((m) => m[1]);
}

// Matches a literal Tailwind color utility (e.g. bg-gray-50, text-red-600,
// border-gray-200) but never a --color-* CSS custom property reference, a
// semantic class like `text-text-secondary`/`bg-surface-recessed`, or a
// doc-comment's own prose describing the pre-migration classes (scoped to
// class-attribute-shaped tokens by requiring the literal Tailwind family
// is immediately followed by a numeric shade, which never appears in this
// app's own semantic token names).
// "white" is deliberately excluded: `text-white` next to a solid
// `bg-accent`/`bg-danger-button` fill is this app's own established,
// intentional pattern (Button's own primary/danger variants already
// ship this way) — not a theme-reactive literal like gray/black/red/
// green/amber, which this migration's own target files never need for
// a legitimate reason.
const LITERAL_COLOR_CLASS = /\b(?:bg|text|border|ring|focus-visible:ring)-(?:gray|black|red|green|amber)-?\d*\b/;

function stripDocComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Pre-Auth Redesign Slice A — fixed-dark shell theme-token migration", () => {
  describe("AuthShell", () => {
    it("no longer contains a literal theme-invariant color class outside its own doc comment", () => {
      expect(stripDocComments(AUTH_SHELL)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("applies both the fixed-dark token class and the page-level gradient class to its own outer wrapper", () => {
      expect(AUTH_SHELL).toMatch(/className="auth-shell auth-shell-page/);
    });

    it("reuses the existing shared CARD_SURFACE_CLASSES constant for the card, rather than duplicating its literal classes", () => {
      expect(AUTH_SHELL).toMatch(/import\s*\{\s*CARD_SURFACE_CLASSES\s*\}\s*from\s*"@\/components\/ui\/surface"/);
      expect(AUTH_SHELL).toMatch(/CARD_SURFACE_CLASSES/);
    });

    it("renders the brand mark + wordmark, and supports an optional top-right contextual action", () => {
      expect(AUTH_SHELL).toMatch(/AqenraMarkIcon/);
      expect(AUTH_SHELL).toMatch(/siteConfig\.name/);
      expect(AUTH_SHELL).toMatch(/topRightAction/);
    });
  });

  describe("AqenraMarkIcon", () => {
    const ICONS = readFileSync(join(__dirname, "../../src/components/ui/icons.tsx"), "utf-8");

    it("is decorative (aria-hidden) and reuses the exact existing favicon geometry/colors, never a new arbitrary mark", () => {
      const match = ICONS.match(/export function AqenraMarkIcon[\s\S]*?\n}/);
      expect(match, "expected to find AqenraMarkIcon").not.toBeNull();
      const body = match![0];
      expect(body).toMatch(/aria-hidden="true"/);
      expect(body).toMatch(/#2E2A6B/);
      expect(body).toMatch(/#6C65C9/);
    });
  });

  describe("Footer — a plain Server Component again, unconditionally light/theme-reactive, never dark-aware", () => {
    const FOOTER = readFileSync(join(__dirname, "../../src/components/layout/footer.tsx"), "utf-8");

    it("is NOT a Client Component, and never imports usePathname — the usePathname-based approach was tried and reverted (its own doc comment names usePathname only in historical prose, never in a live import)", () => {
      expect(FOOTER).not.toMatch(/^"use client";/);
      expect(stripDocComments(FOOTER)).not.toMatch(/usePathname/);
    });

    it("renders unconditionally — no forceDark branch, no route-conditional class, byte-for-byte its pre-redesign behavior", () => {
      expect(FOOTER).toMatch(/className="border-border-default bg-surface border-t"/);
      expect(FOOTER).not.toMatch(/forceDark/);
    });

    it("Privacy Policy / Terms of Service links are still present, unconditionally", () => {
      expect(FOOTER).toMatch(/href="\/privacy"/);
      expect(FOOTER).toMatch(/href="\/terms"/);
      expect(FOOTER).toMatch(/Privacy Policy/);
      expect(FOOTER).toMatch(/Terms of Service/);
    });
  });

  describe("globals.css — pure-CSS visibility rule hides the global Footer under AuthShell, no JavaScript involved", () => {
    const GLOBALS_CSS = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf-8");

    it("the body:has(.auth-shell) footer rule exists, sets display: none, and excludes .auth-shell-footer — without that exclusion the rule also hides AuthShell's own local footer (it's a footer descendant of a body that has .auth-shell too), not just the global one", () => {
      const match = GLOBALS_CSS.match(
        /body:has\(\.auth-shell\)\s*footer:not\(\.auth-shell-footer\)\s*\{\s*display:\s*none;\s*\}/,
      );
      expect(match, "expected to find the body:has(.auth-shell) footer:not(.auth-shell-footer) rule").not.toBeNull();
    });
  });

  describe("AuthShell's own local footer — the one place Privacy/Terms actually renders on these routes", () => {
    it("carries the auth-shell-footer class the globals.css exclusion rule above depends on", () => {
      expect(AUTH_SHELL).toMatch(/<footer className="auth-shell-footer/);
    });

    it("reuses getPlatformLegalConfig() (the same source the global Footer already used) rather than inventing new legal copy", () => {
      expect(AUTH_SHELL).toMatch(
        /import\s*\{\s*getPlatformLegalConfig\s*\}\s*from\s*"@\/lib\/legal\/platform-config"/,
      );
      expect(AUTH_SHELL).toMatch(/legalConfig\.legalName/);
    });

    it("renders Privacy Policy / Terms of Service links", () => {
      expect(AUTH_SHELL).toMatch(/href="\/privacy"/);
      expect(AUTH_SHELL).toMatch(/href="\/terms"/);
    });

    // Privacy & Cookie Policy Improvement, Slice 2 AuthShell follow-up.
    it("also renders a Cookie Policy link to /cookies, alongside the existing two — not a replacement for either", () => {
      expect(AUTH_SHELL).toMatch(/href="\/cookies"/);
      expect(AUTH_SHELL).toMatch(/Cookie Policy/);
    });

    it("the Cookie Policy link reuses the same FOOTER_LINK_CLASSES as Privacy Policy / Terms — no bespoke styling", () => {
      const nav = AUTH_SHELL.match(/<nav className="flex gap-4">[\s\S]*?<\/nav>/)?.[0] ?? "";
      const cookiesLink = nav.match(/<Link href="\/cookies"[\s\S]*?<\/Link>/)?.[0] ?? "";
      expect(cookiesLink).toContain("className={FOOTER_LINK_CLASSES}");
    });

    it("exactly one <footer> element exists in this file — no duplicated/second footer was introduced", () => {
      const footerOpenTags = AUTH_SHELL.match(/<footer\b/g) ?? [];
      expect(footerOpenTags).toHaveLength(1);
    });
  });

  describe("LoginForm", () => {
    it("no longer contains a literal theme-invariant color class outside its own doc comment", () => {
      expect(stripDocComments(LOGIN_FORM)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("the secondary cross-link reads 'Create account', normalized per Slice A's own content model", () => {
      expect(LOGIN_FORM).toMatch(/Create account/);
      expect(LOGIN_FORM).not.toMatch(/>\s*Sign up\s*</);
    });

    it("reuses the existing shared ACTION_LINK_CLASSES constant for both secondary links, rather than hand-rolled literal classes", () => {
      expect(LOGIN_FORM).toMatch(/import\s*\{\s*ACTION_LINK_CLASSES\s*\}\s*from\s*"@\/components\/ui\/action-link-classes"/);
      expect(LOGIN_FORM.match(/ACTION_LINK_CLASSES/g)?.length).toBe(3); // 1 import + 2 call sites (Forgot password?, Create account)
    });
  });

  describe("SignupForm", () => {
    it("no longer contains a literal theme-invariant color class outside its own doc comment", () => {
      expect(stripDocComments(SIGNUP_FORM)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("the primary CTA reads 'Create account', normalized per Slice A's own content model", () => {
      expect(SIGNUP_FORM).toMatch(/"Creating account…" : "Create account"/);
    });

    it("the explicit legal agreement sentence is preserved verbatim", () => {
      expect(SIGNUP_FORM).toMatch(/By creating an account, you agree to our/);
      expect(SIGNUP_FORM).toMatch(/Terms of Service/);
      expect(SIGNUP_FORM).toMatch(/Privacy Policy/);
    });

    it("reuses the existing shared ACTION_LINK_CLASSES constant for all three links, rather than hand-rolled literal classes", () => {
      expect(SIGNUP_FORM).toMatch(/import\s*\{\s*ACTION_LINK_CLASSES\s*\}\s*from\s*"@\/components\/ui\/action-link-classes"/);
      expect(SIGNUP_FORM.match(/ACTION_LINK_CLASSES/g)?.length).toBe(4); // 1 import + 3 call sites (Terms, Privacy, Sign in)
    });

    it("no Phone field exists anywhere — Slice B is explicitly out of scope", () => {
      expect(SIGNUP_FORM.toLowerCase()).not.toMatch(/phone/);
    });
  });

  describe("Staff Auth page headings", () => {
    it("login/page.tsx's 'Sign in' heading is semantic and uses the larger hierarchy", () => {
      const headings = headingClassStrings(LOGIN_PAGE);
      expect(headings).toHaveLength(1);
      expect(headings[0]).toMatch(/\btext-text-primary\b/);
      expect(headings[0]).toMatch(/\btext-3xl\b/);
      expect(headings[0]).toMatch(/\bsm:text-4xl\b/);
    });

    it("login/page.tsx's top-right action is 'Create account' -> /signup", () => {
      expect(LOGIN_PAGE).toMatch(/label:\s*"Create account"/);
      expect(LOGIN_PAGE).toMatch(/\/signup/);
    });

    it("signup/page.tsx's 'Create an account' heading is semantic and uses the larger hierarchy", () => {
      const headings = headingClassStrings(SIGNUP_PAGE);
      expect(headings).toHaveLength(1);
      expect(headings[0]).toMatch(/\btext-text-primary\b/);
      expect(headings[0]).toMatch(/\btext-3xl\b/);
    });

    it("signup/page.tsx's top-right action is 'Sign in' -> /login", () => {
      expect(SIGNUP_PAGE).toMatch(/label:\s*"Sign in"/);
      expect(SIGNUP_PAGE).toMatch(/\/login/);
    });

    it("forgot-password/page.tsx's heading reads 'Reset your password' (Slice A content-model normalization) and is semantic", () => {
      const headings = headingClassStrings(FORGOT_PASSWORD_PAGE);
      expect(headings).toHaveLength(1);
      expect(headings[0]).toMatch(/\btext-text-primary\b/);
      expect(FORGOT_PASSWORD_PAGE).toMatch(/Reset your password/);
    });

    it("reset-password/page.tsx's BOTH headings ('Set a new password' and 'This link is invalid or has expired') are semantic, and the invalid-link branch no longer uses any literal gray/black class", () => {
      const headings = headingClassStrings(RESET_PASSWORD_PAGE);
      expect(headings).toHaveLength(2);
      for (const headingClasses of headings) {
        expect(headingClasses).toMatch(/\btext-text-primary\b/);
      }
      expect(stripDocComments(RESET_PASSWORD_PAGE)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("login/page.tsx's session-expired banner now uses the semantic warning tokens, not the literal amber classes", () => {
      expect(stripDocComments(LOGIN_PAGE)).not.toMatch(LITERAL_COLOR_CLASS);
      expect(LOGIN_PAGE).toMatch(/border-warning/);
      expect(LOGIN_PAGE).toMatch(/bg-warning-subtle/);
      expect(LOGIN_PAGE).toMatch(/text-warning/);
    });
  });

  describe("Root (/), invite, organization-unavailable, and auth error — newly migrated onto AuthShell", () => {
    it("root page uses AuthShell and the existing siteConfig.description copy, never a new hardcoded description", () => {
      expect(ROOT_PAGE).toMatch(/import\s*\{\s*AuthShell\s*\}\s*from\s*"@\/components\/auth\/auth-shell"/);
      expect(ROOT_PAGE).toMatch(/siteConfig\.description/);
      expect(stripDocComments(ROOT_PAGE)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("invite page uses AuthShell, and the top-right action is omitted once a user is authenticated (never a false 'Sign in')", () => {
      expect(INVITE_PAGE).toMatch(/import\s*\{\s*AuthShell\s*\}\s*from\s*"@\/components\/auth\/auth-shell"/);
      expect(INVITE_PAGE).toMatch(/authUser \? undefined : \{ label: "Sign in"/);
      expect(stripDocComments(INVITE_PAGE)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("accept-invitation-form's error text uses the semantic danger token", () => {
      expect(ACCEPT_INVITATION_FORM).toMatch(/text-danger/);
      expect(stripDocComments(ACCEPT_INVITATION_FORM)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("organization-unavailable page uses AuthShell, still renders no form and no mutation control, and its fixed generic copy — including the original plain-text fallback sentence — is unchanged", () => {
      expect(ORG_UNAVAILABLE_PAGE).toMatch(/import\s*\{\s*AuthShell\s*\}\s*from\s*"@\/components\/auth\/auth-shell"/);
      // The exact original sentence must still exist verbatim — it's the
      // fallback branch's rendered text when no support email resolves
      // (see organization-unavailable-support-link.test.ts for the
      // real-runtime proof of that branch).
      expect(ORG_UNAVAILABLE_PAGE).toMatch(/This workspace is currently unavailable\. Contact support\./);
      expect(ORG_UNAVAILABLE_PAGE).not.toMatch(/<form/);
      expect(stripDocComments(ORG_UNAVAILABLE_PAGE)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("organization-unavailable's support contact reuses the canonical getPlatformLegalConfig() — never a hardcoded support@aqenra.com literal, never a second config source", () => {
      expect(ORG_UNAVAILABLE_PAGE).toMatch(
        /import\s*\{\s*getPlatformLegalConfig\s*\}\s*from\s*"@\/lib\/legal\/platform-config"/,
      );
      expect(ORG_UNAVAILABLE_PAGE).toMatch(/supportEmail/);
      expect(ORG_UNAVAILABLE_PAGE).toMatch(/mailto:\$\{supportEmail\}/);
      expect(ORG_UNAVAILABLE_PAGE).not.toMatch(/support@aqenra\.com/);
    });

    it("the (auth) error fallback uses AuthShell and still exposes no error detail (no error.message, no digest rendered)", () => {
      expect(AUTH_ERROR).toMatch(/import\s*\{\s*AuthShell\s*\}\s*from\s*"@\/components\/auth\/auth-shell"/);
      expect(AUTH_ERROR).not.toMatch(/\{error\.message\}/);
      expect(AUTH_ERROR).not.toMatch(/\{error\.digest\}/);
      expect(stripDocComments(AUTH_ERROR)).not.toMatch(LITERAL_COLOR_CLASS);
    });
  });

  it("no auth logic changed — every existing hidden field, autocomplete value, and href this slice must preserve is still present", () => {
    expect(LOGIN_FORM).toMatch(/autoComplete="email"/);
    expect(LOGIN_FORM).toMatch(/autoComplete="current-password"/);
    expect(LOGIN_FORM).toMatch(/href="\/forgot-password"/);

    expect(SIGNUP_FORM).toMatch(/autoComplete="organization"/);
    expect(SIGNUP_FORM).toMatch(/autoComplete="email"/);
    expect(SIGNUP_FORM).toMatch(/autoComplete="new-password"/);
    expect(SIGNUP_FORM).toMatch(/href="\/terms"/);
    expect(SIGNUP_FORM).toMatch(/href="\/privacy"/);
    expect(SIGNUP_FORM).toMatch(/invitationToken/);
    expect(SIGNUP_FORM).toMatch(/readOnly=\{Boolean\(invitation\)\}/);
  });

  it("no phone field/copy anywhere across every migrated pre-auth surface — Slice B is explicitly out of scope", () => {
    for (const source of [AUTH_SHELL, LOGIN_PAGE, SIGNUP_PAGE, FORGOT_PASSWORD_PAGE, RESET_PASSWORD_PAGE, ROOT_PAGE, INVITE_PAGE, ORG_UNAVAILABLE_PAGE, AUTH_ERROR]) {
      expect(source.toLowerCase()).not.toMatch(/phone|\bsms\b|\botp\b/);
    }
  });
});
