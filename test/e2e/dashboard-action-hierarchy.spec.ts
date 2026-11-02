import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { testEmail, testSlug } from "../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../support/env";

/**
 * First-Time User Experience V2, Slice D -- while the onboarding card is
 * actually rendered, the three Dashboard header actions use the secondary
 * link appearance and "Get started" is the one solid primary; otherwise the
 * header actions keep their primary look. Labels/hrefs never change. Every
 * state comes from real data / the real Dismiss button -- completion is never
 * faked.
 */

let fixtures: TestFixtures;
const created: { orgId: string; userIds: string[] }[] = [];

const ACTIONS = [
  { name: "Add client", href: "/clients/new" },
  { name: "Create invoice", href: "/invoices/new" },
  { name: "View overdue tasks", href: "/tasks?overdue=true" },
];

async function actAs(context: BrowserContext, baseURL: string, user: { id: string; email: string }, organizationId: string, theme?: string) {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  const domain = new URL(baseURL).hostname;
  await context.addCookies([
    { name: "active_organization_id", value: organizationId, domain, path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
    ...(theme ? [{ name: "aqenra_theme", value: theme, domain, path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const }] : []),
  ]);
}

type Fresh = { orgId: string; owner: { id: string; email: string }; member: { id: string; email: string } };

async function fresh(label: string, opts: { profile?: boolean; demo?: boolean } = {}): Promise<Fresh> {
  const org = await dbQuery<{ id: string }>("organization", "create", {
    data: { name: `Hier ${label}`, slug: testSlug(`dash-hier-${label}`, fixtures.runId), isDemo: opts.demo ?? false },
  });
  const mk = (role: string) =>
    dbQuery<{ id: string; email: string }>("user", "create", {
      data: { id: randomUUID(), email: testEmail(`dash-hier-${label}-${role}`, TEST_EMAIL_DOMAIN, fixtures.runId), name: role },
    });
  const owner = await mk("owner");
  const member = await mk("member");
  await dbQuery("membership", "create", { data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  await dbQuery("membership", "create", { data: { userId: member.id, organizationId: org.id, role: "MEMBER" } });
  if (opts.profile) {
    await dbQuery("organizationProfile", "create", {
      data: { organizationId: org.id, legalName: `Hier ${label} LLC`, country: "United States", currency: "USD", timezone: "America/New_York" },
    });
  }
  created.push({ orgId: org.id, userIds: [owner.id, member.id] });
  return { orgId: org.id, owner, member };
}

const card = (page: Page) => page.getByRole("region", { name: "Getting started" });
const action = (page: Page, name: string) => page.getByRole("link", { name, exact: true });

async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function expectLabelsAndHrefs(page: Page) {
  for (const { name, href } of ACTIONS) {
    await expect(action(page, name)).toBeVisible();
    await expect(action(page, name)).toHaveAttribute("href", href);
  }
}

async function expectPrimary(page: Page) {
  for (const { name } of ACTIONS) {
    await expect(action(page, name)).toHaveClass(/bg-accent/);
    await expect(action(page, name)).not.toHaveClass(/border-border-strong/);
  }
}

async function expectSecondary(page: Page) {
  for (const { name } of ACTIONS) {
    await expect(action(page, name)).toHaveClass(/border-border-strong/);
    await expect(action(page, name)).toHaveClass(/bg-surface/);
    await expect(action(page, name)).not.toHaveClass(/bg-accent/);
  }
}

async function contrastRatio(link: Locator): Promise<number> {
  return link.evaluate((el) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const rgb = (value: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    };
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const style = getComputedStyle(el);
    const fg = lum(rgb(style.color));
    const bg = lum(rgb(style.backgroundColor));
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
}

test.describe("Dashboard quick action hierarchy", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    for (const { orgId, userIds } of created) {
      await dbQuery("organization", "delete", { where: { id: orgId } });
      for (const id of userIds) await dbQuery("user", "delete", { where: { id } });
    }
    await cleanupTestData(fixtures);
  });

  test("onboarding card visible: the three header actions are secondary, 'Get started' is the one primary, labels and hrefs unchanged", async ({ context, baseURL, page }) => {
    const f = await fresh("visible");
    await actAs(context, baseURL!, f.owner, f.orgId);
    await openDashboard(page);

    await expect(card(page)).toBeVisible();
    await expectLabelsAndHrefs(page);
    await expectSecondary(page);
    await expect(card(page).getByRole("link", { name: "Get started" })).toHaveClass(/bg-accent/);
    // Exactly one solid-primary link on the whole header + card area.
    await expect(page.locator("main a.bg-accent")).toHaveCount(1);
  });

  test("a role-blocked next step (MEMBER, Company Profile): the card shows its message, no invented CTA, header actions stay secondary", async ({ context, baseURL, page }) => {
    const f = await fresh("blocked");
    await actAs(context, baseURL!, f.member, f.orgId);
    await openDashboard(page);

    await expect(card(page)).toBeVisible();
    await expect(card(page).getByText("Ask your workspace owner to complete the company profile.")).toBeVisible();
    await expect(card(page).getByRole("link", { name: "Get started" })).toHaveCount(0);
    await expectLabelsAndHrefs(page);
    await expectSecondary(page);
    await expect(page.locator("main a.bg-accent")).toHaveCount(0);
  });

  test("dismissed onboarding: the card disappears and the header actions return to primary", async ({ context, baseURL, page }) => {
    const f = await fresh("dismissed");
    await actAs(context, baseURL!, f.owner, f.orgId);
    await openDashboard(page);
    await expectSecondary(page);

    await page.getByRole("button", { name: "Dismiss onboarding" }).click();
    await expect(card(page)).toHaveCount(0);
    await page.reload();
    await expect(card(page)).toHaveCount(0);
    await expectLabelsAndHrefs(page);
    await expectPrimary(page);
  });

  test("completed onboarding (real data on the shared fixture org): no card, header actions primary as before", async ({ context, baseURL, page }) => {
    await dbQuery("organizationProfile", "create", {
      data: { organizationId: fixtures.orgA.id, legalName: "Test Org A LLC", country: "United States", currency: "USD", timezone: "America/New_York" },
    });
    try {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await openDashboard(page);
      await expect(card(page)).toHaveCount(0);
      await expectLabelsAndHrefs(page);
      await expectPrimary(page);
    } finally {
      await dbQuery("organizationProfile", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    }
  });

  test("demo workspace with a still-visible onboarding card: header actions are secondary and the card CTA keeps its target", async ({ context, baseURL, page }) => {
    const f = await fresh("demo", { demo: true, profile: true });
    const client = await dbQuery<{ id: string }>("client", "create", { data: { name: "Demo Client", organizationId: f.orgId, userId: f.owner.id } });
    const project = await dbQuery<{ id: string }>("project", "create", {
      data: { name: "Demo Project", organizationId: f.orgId, clientId: client.id, ownerId: f.owner.id },
    });
    await dbQuery("task", "create", { data: { title: "Demo task", projectId: project.id, organizationId: f.orgId } });
    // Sample data never includes a second teammate: drop the helper member so
    // the Invite step (the only remaining one) is genuinely still open.
    await dbQuery("membership", "deleteMany", { where: { userId: f.member.id, organizationId: f.orgId } });
    try {
      await actAs(context, baseURL!, f.owner, f.orgId);
      await openDashboard(page);

      await expect(card(page)).toBeVisible();
      await expectSecondary(page);
      await expect(card(page).getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/team");
    } finally {
      await dbQuery("task", "deleteMany", { where: { organizationId: f.orgId } });
      await dbQuery("project", "deleteMany", { where: { organizationId: f.orgId } });
      await dbQuery("client", "deleteMany", { where: { organizationId: f.orgId } });
    }
  });

  test("390px: all actions stay visible and usable with no horizontal overflow, in both states", async ({ context, baseURL, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const f = await fresh("mobile");
    await actAs(context, baseURL!, f.owner, f.orgId);
    await openDashboard(page);
    await expectLabelsAndHrefs(page);
    await expectSecondary(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
    for (const { name } of ACTIONS) {
      const box = await action(page, name).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.height).toBeGreaterThanOrEqual(36);
    }
  });

  test("accessibility: demoted actions are real links reachable by keyboard with a visible focus ring, and meet 4.5:1 contrast in light and dark", async ({ context, baseURL, page }) => {
    const f = await fresh("a11y");
    for (const theme of ["light.light", "dark.dark"]) {
      await actAs(context, baseURL!, f.owner, f.orgId, theme);
      await openDashboard(page);
      for (const { name } of ACTIONS) {
        expect(await contrastRatio(action(page, name))).toBeGreaterThanOrEqual(4.5);
      }
    }

    const link = action(page, "Add client");
    await expect(link).toHaveClass(/focus-visible:ring-2/);
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await link.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    const ring = await link.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).not.toBe("none");
  });
});
