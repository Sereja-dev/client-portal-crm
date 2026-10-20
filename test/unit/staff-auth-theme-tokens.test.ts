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
