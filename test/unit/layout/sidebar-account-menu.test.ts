import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sidebar Account Menu V1 — source-contract proxy (no DOM/component-
 * interaction harness exists in this repo for anything importing
 * next/link — see button-variant-contract.test.ts's own header comment
 * for the same reasoning; SidebarAccountMenu renders three next/link
 * `<Link>`s, so renderToStaticMarkup is not used here).
 *
 * Covers the Product Owner's exact approved V1 content — Appearance,
 * Notifications, Billing, a separator, then Sign out — and proves
 * nothing speculative (Profile, Team, Company, Roles, Tags, Templates,
 * Integrations, Payment details, Platform Admin, any OWNER/ADMIN-only
 * workspace-admin link) was added.
 */
const source = readFileSync("src/components/layout/sidebar-account-menu.tsx", "utf8");

describe("SidebarAccountMenu — identity row", () => {
  it("renders both name and email (trigger row + menu header), and the component's own props are exactly {name, email} — never an id or organizationId prop", () => {
    expect(source).toMatch(/\{name\}/);
    expect(source).toMatch(/\{email\}/);
    expect(source).toMatch(/export function SidebarAccountMenu\(\{ name, email \}: \{ name: string; email: string \}\)/);
  });

  it("uses the new Avatar primitive, never a raw <img>", () => {
    expect(source).toMatch(/<Avatar\s+name=\{name\}/);
    expect(source).not.toMatch(/<img\b/);
  });

  it("desktop-only wrapper: hidden by default, visible only at md and up", () => {
    expect(source).toMatch(/className="[^"]*\bhidden\b[^"]*\bmd:block\b[^"]*"/);
  });
});

describe("SidebarAccountMenu — exact V1 menu contents, nothing speculative", () => {
  it("links to exactly Appearance, Notifications, and Billing — the existing full pages, unchanged routes", () => {
    expect(source).toContain('href="/settings/appearance"');
    expect(source).toContain('href="/settings/notifications"');
    expect(source).toContain('href="/settings/billing"');
  });

  it("Appearance/Notifications/Billing are plain links — no inline theme toggle, no embedded billing controls, no duplicated notification controls", () => {
    expect(source).not.toMatch(/useTheme|ThemeMode|updateThemeModeAction/);
    expect(source).not.toMatch(/getBillingPageData|CurrentPlanSection|PlansSection/);
    expect(source).not.toMatch(/NotificationBell|getUnreadNotificationCount/);
  });

  it("never links to Profile, Team, Company, Roles/Permissions, Tags, Templates, Integrations, Payment details, or Platform Admin", () => {
    for (const forbidden of [
      "/settings/profile",
      "/team",
      "/settings/company",
      "/team/permissions",
      "/settings/tags",
      "/settings/templates",
      "/settings/invoice-templates",
      "/settings/contract-templates",
      "/settings/integrations",
      "/settings/payment",
      "/platform-admin",
    ]) {
      expect(source).not.toContain(`href="${forbidden}"`);
    }
  });

  it("reuses the existing signOut() Server Action unchanged — no new logout implementation", () => {
    expect(source).toMatch(/import\s*\{\s*signOut\s*\}\s*from\s*"@\/app\/\(dashboard\)\/actions"/);
    expect(source).toMatch(/<form action=\{signOut\}>/);
  });

  it("Sign out uses the new SignOutIcon plus the unchanged label text", () => {
    expect(source).toMatch(/<SignOutIcon\b/);
    const buttonMatch = source.match(/<button type="submit"[\s\S]*?<\/button>/);
    expect(buttonMatch, "expected to find the Sign out <button>").not.toBeNull();
    expect(buttonMatch![0]).toMatch(/\bSign out\b/);
    expect(buttonMatch![0]).not.toMatch(/\bExit\b/);
    expect(buttonMatch![0]).not.toMatch(/\bLog out\b/);
  });

  it("a visual separator exists between the links and Sign out", () => {
    expect(source).toMatch(/border-t/);
  });
});

describe("SidebarAccountMenu — built on the sibling PopoverMenu primitive, not RowActionMenu directly", () => {
  it("imports PopoverMenu, not RowActionMenu, as its own trigger/positioning primitive", () => {
    expect(source).toMatch(/import\s*\{\s*PopoverMenu\s*\}\s*from\s*"@\/components\/ui\/popover-menu"/);
  });

  it("reuses RowActionMenuItem unmodified for item markup (role=menuitem tagging), and never renders the actual <RowActionMenu> trigger component itself", () => {
    expect(source).toMatch(/import\s*\{\s*RowActionMenuItem\s*\}\s*from\s*"@\/components\/ui\/row-action-menu"/);
    expect(source).not.toMatch(/<RowActionMenu\b/);
  });
});

/**
 * Light hover visibility fix (broader scope, PR following #227) — the
 * owner reported the same barely-visible hover problem here, against
 * this menu's own white popover-menu.tsx panel (`bg-surface`), as PR
 * #227 fixed for the Sidebar. Root cause and fix were the shared
 * --hover token itself (globals.css), not this component — these tests
 * are this component's own regression guard against that token
 * drifting back toward invisible against ITS specific background,
 * parsed live from the real globals.css (same approach as
 * sidebar-hover-visibility.test.ts) rather than duplicated hex
 * constants.
 */
describe("Light — the account menu's own hover treatment is clearly visible against its real bg-surface (white) panel", () => {
  const CSS = readFileSync(join(__dirname, "../../../src/app/globals.css"), "utf-8");
  const lightBlockMatch = CSS.match(/^:root\s*\{([\s\S]*?)\n\}/m);
  const LIGHT_BLOCK = lightBlockMatch?.[1] ?? "";
  const darkBlockMatch = CSS.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  const DARK_BLOCK = darkBlockMatch?.[1] ?? "";

  function declaredValueIn(block: string, varName: string): string | undefined {
    const match = block.match(new RegExp(`--${varName}\\s*:\\s*([^;]+);`));
    return match?.[1]?.trim();
  }

  function hexToRgb(hex: string): [number, number, number] {
    const normalized = hex.replace("#", "");
    return [
      parseInt(normalized.slice(0, 2), 16),
      parseInt(normalized.slice(2, 4), 16),
      parseInt(normalized.slice(4, 6), 16),
    ];
  }

  function channelLuminance(channel: number): number {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
  }

  function contrastRatio(hexA: string, hexB: string): number {
    const lumA = relativeLuminance(hexA);
    const lumB = relativeLuminance(hexB);
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // --surface is `var(--background)` (one flat surface today, per its
  // own alias comment) — resolved one level rather than hardcoded, so
  // this still fails if that aliasing itself ever changes.
  function resolveSurface(block: string): string {
    const raw = declaredValueIn(block, "surface")!;
    const aliasMatch = raw.match(/^var\(--(\S+)\)/);
    return aliasMatch ? declaredValueIn(block, aliasMatch[1])! : raw;
  }

  it("trigger button and every menu item still use the shared --hover token, not a hardcoded or component-local value", () => {
    expect(source).toMatch(/hover:bg-\[var\(--hover\)\]/);
    expect(source).not.toMatch(/hover:bg-\[#[0-9A-Fa-f]{3,8}\]/);
  });

  it("the new --hover is meaningfully visible against this menu's real bg-surface panel — at least the same 1.1:1 floor sidebar-hover-visibility.test.ts already established for the Sidebar's own background", () => {
    const hover = declaredValueIn(LIGHT_BLOCK, "hover")!;
    const surface = resolveSurface(LIGHT_BLOCK);
    expect(contrastRatio(hover, surface)).toBeGreaterThanOrEqual(1.1);
  });

  it("the old, reported-too-weak value (#FAFAFA) would NOT have cleared that floor against this panel — proves the floor is a real discriminator, not trivially satisfied by anything", () => {
    const surface = resolveSurface(LIGHT_BLOCK);
    expect(contrastRatio("#FAFAFA", surface)).toBeLessThan(1.1);
  });

  it("Dark's --hover is untouched by this broader fix (still the original translucent white overlay)", () => {
    const darkHover = declaredValueIn(DARK_BLOCK, "hover");
    expect(darkHover).toBe("rgba(255, 255, 255, 0.06)");
  });
});
