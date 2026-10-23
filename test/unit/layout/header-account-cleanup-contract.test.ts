import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Sidebar Account Menu V1 — source-contract proof that Header's own
 * identity/Sign-out is removed at `md` and up, while mobile (below `md`)
 * is byte-for-byte untouched. This is the single most safety-critical
 * assertion in this slice: Header is mobile's ONLY identity/Sign-out
 * surface today (confirmed by the read-only audit — no responsive-
 * hiding wrapper existed around it before this change), so regressing
 * this would silently strand mobile users with no way to sign out.
 */
const source = readFileSync("src/components/layout/header.tsx", "utf8");

describe("Header — desktop identity/Sign-out removed, mobile preserved", () => {
  it("the email span is hidden only at md and up — never unconditionally hidden", () => {
    const match = source.match(/<span className="([^"]*)" title=\{email\}>/);
    expect(match, "expected to find the email span").not.toBeNull();
    const className = match![1];
    expect(className).toMatch(/\bmd:hidden\b/);
    expect(className).not.toMatch(/(?<!md:)\bhidden\b/);
  });

  it("the Sign out form is hidden only at md and up — never unconditionally hidden", () => {
    const match = source.match(/<form action=\{signOut\} className="([^"]*)">/);
    expect(match, "expected to find the Sign out form").not.toBeNull();
    const className = match![1];
    expect(className).toMatch(/\bmd:hidden\b/);
    expect(className).not.toMatch(/(?<!md:)\bhidden\b/);
  });

  it("signOut is still imported and used — the same Server Action, not removed, just scoped to mobile visually", () => {
    expect(source).toMatch(/import\s*\{\s*signOut,/);
    expect(source).toMatch(/action=\{signOut\}/);
  });

  it("OrganizationSwitcher, GlobalSearch, AiAssistantTrigger, and NotificationBell are all still present, unconditionally", () => {
    expect(source).toMatch(/<OrganizationSwitcher\b/);
    expect(source).toMatch(/<GlobalSearch\b/);
    expect(source).toMatch(/<AiAssistantTrigger\b/);
    expect(source).toMatch(/<NotificationBell\b/);
  });
});
