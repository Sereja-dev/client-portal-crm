import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { testEmail, testSlug } from "../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../support/env";

/**
 * First-Time User Experience V2, Slice C — the Dashboard onboarding CTA
 * links to the single ELIGIBLE Client/Project when one exists, and keeps the
 * generic destination otherwise. Every fixture places the onboarding at the
 * intended next step through real data only (a Company Profile row, plus
 * Clients/Projects); completion is never faked.
 */

let fixtures: TestFixtures;
const createdOrgs: { orgId: string; userId: string }[] = [];

async function actAs(context: BrowserContext, baseURL: string, user: { id: string; email: string }, organizationId: string) {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await context.addCookies([
    { name: "active_organization_id", value: organizationId, domain: new URL(baseURL).hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

const card = (page: Page) => page.getByRole("region", { name: "Getting started" });
const cta = (page: Page) => card(page).getByRole("link", { name: "Get started" });

type Fresh = { orgId: string; owner: { id: string; email: string } };

async function fresh(label: string, opts: { demo?: boolean; profile?: boolean } = {}): Promise<Fresh> {
  const org = await dbQuery<{ id: string }>("organization", "create", {
    data: { name: `Ctx ${label}`, slug: testSlug(`onb-ctx-${label}`, fixtures.runId), isDemo: opts.demo ?? false },
  });
  const owner = await dbQuery<{ id: string; email: string }>("user", "create", {
    data: { id: randomUUID(), email: testEmail(`onb-ctx-${label}`, TEST_EMAIL_DOMAIN, fixtures.runId), name: "Owner" },
  });
  await dbQuery("membership", "create", { data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  if (opts.profile !== false) {
    await dbQuery("organizationProfile", "create", {
      data: { organizationId: org.id, legalName: `Ctx ${label} LLC`, country: "United States", currency: "USD", timezone: "America/New_York" },
    });
  }
  createdOrgs.push({ orgId: org.id, userId: owner.id });
  return { orgId: org.id, owner };
}

const addClient = (f: Fresh, status = "ACTIVE") =>
  dbQuery<{ id: string }>("client", "create", { data: { name: `Ctx Client ${randomUUID().slice(0, 6)}`, organizationId: f.orgId, userId: f.owner.id, status } });
const addProject = (f: Fresh, clientId: string, status = "IN_PROGRESS") =>
  dbQuery<{ id: string }>("project", "create", { data: { name: `Ctx Project ${randomUUID().slice(0, 6)}`, organizationId: f.orgId, clientId, ownerId: f.owner.id, status } });

async function openDashboard(context: BrowserContext, baseURL: string, page: Page, f: Fresh) {
  await actAs(context, baseURL, f.owner, f.orgId);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
}

test.describe("Onboarding contextual CTA links", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    for (const { orgId, userId } of createdOrgs) {
      await dbQuery("project", "deleteMany", { where: { organizationId: orgId } });
      await dbQuery("client", "deleteMany", { where: { organizationId: orgId } });
      await dbQuery("organization", "delete", { where: { id: orgId } });
      await dbQuery("user", "delete", { where: { id: userId } });
    }
    await cleanupTestData(fixtures);
  });

  test("one eligible Client -> the CTA opens the Project form with that Client preselected", async ({ context, baseURL, page }) => {
    const f = await fresh("one-client");
    const client = await addClient(f);
    await addClient(f, "ARCHIVED"); // ineligible: must not make it "several"
    await openDashboard(context, baseURL!, page, f);

    await expect(card(page).getByText("Create your first project")).toBeVisible();
    await expect(cta(page)).toHaveAttribute("href", `/projects/new?clientId=${client.id}`);
    await cta(page).click();
    await page.waitForURL(/\/projects\/new/);
    await expect(page.getByLabel("Client")).toHaveValue(client.id);
  });

  test("several eligible Clients -> the generic Project form", async ({ context, baseURL, page }) => {
    const f = await fresh("many-clients");
    await addClient(f);
    await addClient(f, "LEAD");
    await openDashboard(context, baseURL!, page, f);
    await expect(cta(page)).toHaveAttribute("href", "/projects/new");
    await cta(page).click();
    await page.waitForURL(/\/projects\/new$/);
    await expect(page.getByLabel("Client")).toHaveValue("");
  });

  test("only ineligible (archived) Clients -> the generic Project form", async ({ context, baseURL, page }) => {
    const f = await fresh("archived-only");
    await addClient(f, "ARCHIVED");
    await openDashboard(context, baseURL!, page, f);
    await expect(cta(page)).toHaveAttribute("href", "/projects/new");
  });

  test("one eligible Project -> the CTA opens the Task form with that Project preselected and global return semantics (no from=project)", async ({ context, baseURL, page }) => {
    const f = await fresh("one-project");
    const client = await addClient(f);
    const project = await addProject(f, client.id);
    await addProject(f, client.id, "COMPLETED"); // ineligible
    await addProject(f, client.id, "CANCELLED"); // ineligible
    await openDashboard(context, baseURL!, page, f);

    // Task-or-Invoice meaning and copy are unchanged.
    await expect(card(page).getByText("Create a task or invoice")).toBeVisible();
    await expect(card(page).getByText("Add a task to track your work, or create an invoice — either one moves you forward.")).toBeVisible();
    const href = await cta(page).getAttribute("href");
    expect(href).toBe(`/tasks/new?projectId=${project.id}`);
    expect(href).not.toContain("from=");

    await cta(page).click();
    await page.waitForURL(/\/tasks\/new/);
    await expect(page.getByLabel("Project")).toHaveValue(project.id);
    await expect(page.locator('input[name="returnTo"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/tasks");
  });

  test("several eligible Projects -> the generic Task form", async ({ context, baseURL, page }) => {
    const f = await fresh("many-projects");
    const client = await addClient(f);
    await addProject(f, client.id);
    await addProject(f, client.id, "PLANNING");
    await openDashboard(context, baseURL!, page, f);
    await expect(cta(page)).toHaveAttribute("href", "/tasks/new");
  });

  test("only ineligible Projects (completed/cancelled) -> the generic Task form", async ({ context, baseURL, page }) => {
    const f = await fresh("done-projects");
    const client = await addClient(f);
    await addProject(f, client.id, "COMPLETED");
    await addProject(f, client.id, "CANCELLED");
    await openDashboard(context, baseURL!, page, f);
    await expect(cta(page)).toHaveAttribute("href", "/tasks/new");
  });

  test("a fresh workspace is unaffected: Company Profile first, static link", async ({ context, baseURL, page }) => {
    const f = await fresh("fresh", { profile: false });
    await openDashboard(context, baseURL!, page, f);
    await expect(cta(page)).toHaveAttribute("href", "/settings/company");
  });

  test("a demo workspace (sample-like data) is unaffected: contextual steps are already complete and the next step stays static", async ({ context, baseURL, page }) => {
    const f = await fresh("demo", { demo: true });
    const c1 = await addClient(f);
    await addClient(f);
    const project = await addProject(f, c1.id);
    await dbQuery("task", "create", { data: { title: "Sample task", projectId: project.id, organizationId: f.orgId } });
    await openDashboard(context, baseURL!, page, f);

    await expect(card(page).getByText("Invite a teammate or client")).toBeVisible();
    await expect(cta(page)).toHaveAttribute("href", "/team");
  });
});
