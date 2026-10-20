import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Accessibility Improvement A4 — a lightweight source-contract test
 * (same "read the real file as text" approach design-system-foundation-
 * tokens.test.ts/dark-mode-text-muted-contrast.test.ts/form-control-
 * accessibility-tokens.test.ts already established) confirming the
 * three Staff Auth files no longer contain the audited theme-invariant
 * literal Tailwind color classes, and do contain their approved
 * semantic equivalents. Not a full-file snapshot — narrow, targeted
 * presence/absence checks only, so future additive changes to these
 * files don't spuriously fail this suite unless one of the specific
 * guarantees below actually regresses.
 */

const AUTH_CARD = readFileSync(join(__dirname, "../../src/components/auth/auth-card.tsx"), "utf-8");
const LOGIN_FORM = readFileSync(join(__dirname, "../../src/app/(auth)/login/login-form.tsx"), "utf-8");
const SIGNUP_FORM = readFileSync(join(__dirname, "../../src/app/(auth)/signup/signup-form.tsx"), "utf-8");

// A4 remediation (dark-mode heading defect) — the four Staff Auth page
// components, each of which renders its own <h1> directly (outside of
// AuthCard/LoginForm/SignupForm/ForgotPasswordForm/ResetPasswordForm,
// none of which were ever in scope for this bug). Read separately from
// the three files above: these pages still intentionally retain OTHER,
// explicitly deferred literal-color elements (login's session-expired
// amber banner; reset-password's invalid-link gray paragraphs and black
// link) — so, unlike AUTH_CARD/LOGIN_FORM/SIGNUP_FORM above, this suite
// must never assert "no literal color anywhere in this file," only that
// each page's own <h1> specifically is semantic.
const LOGIN_PAGE = readFileSync(join(__dirname, "../../src/app/(auth)/login/page.tsx"), "utf-8");
const SIGNUP_PAGE = readFileSync(join(__dirname, "../../src/app/(auth)/signup/page.tsx"), "utf-8");
const FORGOT_PASSWORD_PAGE = readFileSync(join(__dirname, "../../src/app/(auth)/forgot-password/page.tsx"), "utf-8");
const RESET_PASSWORD_PAGE = readFileSync(join(__dirname, "../../src/app/(auth)/reset-password/page.tsx"), "utf-8");

// Extracts every <h1 className="...">'s own class string — scoped
// narrowly to the heading element itself, never the rest of the file
// (which, for reset-password/page.tsx specifically, still legitimately
// contains other, deferred literal-color classes on sibling elements).
function headingClassStrings(source: string): string[] {
  return [...source.matchAll(/<h1\s+className="([^"]*)"/g)].map((m) => m[1]);
}

// Matches a literal Tailwind color utility (e.g. bg-gray-50, text-red-600,
// border-gray-200) but never a --color-* CSS custom property reference,
// a semantic class like `text-text-secondary`/`bg-surface-recessed`, or
// this file's own doc-comment prose describing the historical classes
// (the three source files' own header comments intentionally still
// *mention* the old literal names while explaining the migration — this
// regex is scoped to class-attribute-shaped tokens, not comment prose,
// by requiring the literal Tailwind family is immediately followed by a
// Tailwind numeric shade, which never appears in this app's own
// semantic token names).
const LITERAL_COLOR_CLASS = /\b(?:bg|text|border|ring|focus-visible:ring)-(?:gray|black|white|red|green)-?\d*\b/;

function stripDocComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Accessibility Improvement A4 — Staff Auth theme-token migration", () => {
  describe("AuthCard", () => {
    it("no longer contains a literal theme-invariant color class outside its own doc comment", () => {
      expect(stripDocComments(AUTH_CARD)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("uses the semantic outer-shell/brand-text tokens", () => {
      expect(AUTH_CARD).toMatch(/bg-surface-recessed/);
      expect(AUTH_CARD).toMatch(/text-text-primary/);
    });

    it("reuses the existing shared CARD_SURFACE_CLASSES constant for the card, rather than duplicating its literal classes", () => {
      expect(AUTH_CARD).toMatch(/import\s*\{\s*CARD_SURFACE_CLASSES\s*\}\s*from\s*"@\/components\/ui\/surface"/);
      expect(AUTH_CARD).toMatch(/CARD_SURFACE_CLASSES/);
    });
  });

  describe("LoginForm", () => {
    it("no longer contains a literal theme-invariant color class outside its own doc comment", () => {
      expect(stripDocComments(LOGIN_FORM)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("uses the semantic error/supporting-copy tokens", () => {
      expect(LOGIN_FORM).toMatch(/text-danger/);
      expect(LOGIN_FORM).toMatch(/text-text-secondary/);
    });

    it("reuses the existing shared ACTION_LINK_CLASSES constant for both secondary links, rather than hand-rolled literal classes", () => {
      expect(LOGIN_FORM).toMatch(/import\s*\{\s*ACTION_LINK_CLASSES\s*\}\s*from\s*"@\/components\/ui\/action-link-classes"/);
      expect(LOGIN_FORM.match(/ACTION_LINK_CLASSES/g)?.length).toBe(3); // 1 import + 2 call sites (Forgot password?, Sign up)
    });
  });

  describe("SignupForm", () => {
    it("no longer contains a literal theme-invariant color class outside its own doc comment", () => {
      expect(stripDocComments(SIGNUP_FORM)).not.toMatch(LITERAL_COLOR_CLASS);
    });

    it("uses the semantic primary/secondary/muted/error/success tokens", () => {
      expect(SIGNUP_FORM).toMatch(/text-text-primary/);
      expect(SIGNUP_FORM).toMatch(/text-text-secondary/);
      expect(SIGNUP_FORM).toMatch(/text-text-muted/);
      expect(SIGNUP_FORM).toMatch(/text-danger/);
      expect(SIGNUP_FORM).toMatch(/text-success/);
    });

    it("reuses the existing shared ACTION_LINK_CLASSES constant for all three links, rather than hand-rolled literal classes", () => {
      expect(SIGNUP_FORM).toMatch(/import\s*\{\s*ACTION_LINK_CLASSES\s*\}\s*from\s*"@\/components\/ui\/action-link-classes"/);
      expect(SIGNUP_FORM.match(/ACTION_LINK_CLASSES/g)?.length).toBe(4); // 1 import + 3 call sites (Terms, Privacy, Sign in)
    });
  });

  describe("Staff Auth page headings (A4 remediation — dark-mode heading defect)", () => {
    it("login/page.tsx's 'Sign in' heading is semantic", () => {
      const headings = headingClassStrings(LOGIN_PAGE);
      expect(headings).toHaveLength(1);
      expect(headings[0]).toMatch(/\btext-text-primary\b/);
      expect(headings[0]).not.toMatch(/\btext-gray-900\b/);
    });

    it("signup/page.tsx's 'Create an account' heading is semantic", () => {
      const headings = headingClassStrings(SIGNUP_PAGE);
      expect(headings).toHaveLength(1);
      expect(headings[0]).toMatch(/\btext-text-primary\b/);
      expect(headings[0]).not.toMatch(/\btext-gray-900\b/);
    });

    it("forgot-password/page.tsx's 'Forgot your password?' heading is semantic", () => {
      const headings = headingClassStrings(FORGOT_PASSWORD_PAGE);
      expect(headings).toHaveLength(1);
      expect(headings[0]).toMatch(/\btext-text-primary\b/);
      expect(headings[0]).not.toMatch(/\btext-gray-900\b/);
    });

    it("reset-password/page.tsx's BOTH headings ('Set a new password' and 'This link is invalid or has expired') are semantic", () => {
      const headings = headingClassStrings(RESET_PASSWORD_PAGE);
      expect(headings).toHaveLength(2);
      for (const headingClasses of headings) {
        expect(headingClasses).toMatch(/\btext-text-primary\b/);
        expect(headingClasses).not.toMatch(/\btext-gray-900\b/);
      }
    });

    it("reset-password/page.tsx's deferred invalid-link paragraph/link colors are intentionally untouched by this remediation", () => {
      // Narrow, explicit guard against scope creep in the OTHER
      // direction: confirms the deferred findings this slice's own brief
      // explicitly excluded are still present, so a future change can't
      // silently fix (or silently leave broken) these without it being a
      // deliberate, visible decision.
      expect(RESET_PASSWORD_PAGE).toMatch(/text-gray-600/);
      expect(RESET_PASSWORD_PAGE).toMatch(/text-black/);
      expect(RESET_PASSWORD_PAGE).toMatch(/focus-visible:ring-black/);
    });

    it("login/page.tsx's deferred session-expired amber banner is intentionally untouched by this remediation", () => {
      expect(LOGIN_PAGE).toMatch(/border-amber-200/);
      expect(LOGIN_PAGE).toMatch(/bg-amber-50/);
      expect(LOGIN_PAGE).toMatch(/text-amber-800/);
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
});
