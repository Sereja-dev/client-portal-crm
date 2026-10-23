import { readFileSync } from "node:fs";
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
