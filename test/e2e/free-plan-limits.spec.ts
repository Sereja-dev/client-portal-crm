import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Aqenra Free plan — committed, repeatable browser coverage for the Free
 * plan experience, requested explicitly by the implementation-correction
 * task after the pre-push review found no E2E coverage existed for any
 * Free-plan requirement. Covers, through the real built app (never
 * Production):
 *   - Accurate plan usage display, including reaching the 5-active-
 *     project limit and seeing its own dedicated "Limit reached" state.
 *   - A clear, real blocked-operation message from the actual Project
 *     create form when the limit is already reached.
 *   - Creating and editing a custom Project status's active-project
 *     classification, and observing its real effect on the Free plan's
 *     usage count.
 *   - Completed project history staying fully visible and editable.
 *   - Core Staff functionality (clients, projects, invoices) remaining
 *     reachable at/above a limit — never hidden.
 * Client Portal coverage is intentionally NOT attempted here: the test
 * harness's identity-injection cookie (test/support/e2e-session.ts)
 * authenticates a Staff `User` row only — Portal sessions use a
 * completely separate auth path this harness does not stand in for.
 * Portal non-seat-consumption is already verified directly at the
 * integration level (test/integration/billing/enforcement.test.ts).
 */

type OrgFixture = {
  org: { id: string; slug: string };
  owner: { id: string; email: string };
  client: { id: string };
  statusDefinitionIds: Record<"planning" | "in_progress" | "on_hold" | "completed" | "cancelled", string>;
};

async function createFreePlanOrg(label: string): Promise<OrgFixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await dbQuery<{ id: string; slug: string }>("organization", "create", {
    data: { name: `E2E Free Org ${label} ${suffix}`, slug: `e2e-free-${label}-${suffix}` },
  });
  const now = new Date().toISOString();
  await dbQuery("subscription", "create", {
    data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
  });
  const owner = { id: randomUUID(), email: `e2e-free-${label}-owner-${suffix}@test.local` };
  await dbQuery("user", "create", { data: { id: owner.id, email: owner.email, name: `E2E Free Owner ${label}` } });
  await dbQuery("membership", "create", { data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });

  const seeds = [
    { key: "planning", label: "Planning", color: "NEUTRAL", position: 0, isDefault: true, entityType: "PROJECT", countsAsActiveProject: true },
    { key: "in_progress", label: "In Progress", color: "INFO", position: 1, isDefault: false, entityType: "PROJECT", countsAsActiveProject: true },
    { key: "on_hold", label: "On Hold", color: "WARNING", position: 2, isDefault: false, entityType: "PROJECT", countsAsActiveProject: true },
    { key: "completed", label: "Completed", color: "SUCCESS", position: 3, isDefault: false, entityType: "PROJECT", countsAsActiveProject: false },
    { key: "cancelled", label: "Cancelled", color: "DANGER", position: 4, isDefault: false, entityType: "PROJECT", countsAsActiveProject: false },
    { key: "lead", label: "Lead", color: "NEUTRAL", position: 0, isDefault: true, entityType: "CLIENT" },
    { key: "active", label: "Active", color: "SUCCESS", position: 1, isDefault: false, entityType: "CLIENT" },
    { key: "inactive", label: "Inactive", color: "MUTED", position: 2, isDefault: false, entityType: "CLIENT" },
    { key: "archived", label: "Archived", color: "MUTED", position: 3, isDefault: false, entityType: "CLIENT" },
    { key: "new", label: "New", color: "NEUTRAL", position: 0, isDefault: true, entityType: "LEAD" },
  ];
  for (const seed of seeds) {
    await dbQuery("customStatusDefinition", "create", { data: { organizationId: org.id, isSystem: true, ...seed } });
  }

  const client = await dbQuery<{ id: string }>("client", "create", {
    data: { name: `E2E Free Client ${label}`, userId: owner.id, organizationId: org.id },
  });

  const definitions = await dbQuery<{ id: string; key: string }[]>("customStatusDefinition", "findMany", {
    where: { organizationId: org.id, entityType: "PROJECT" },
  });
  const statusDefinitionIds = Object.fromEntries(definitions.map((d) => [d.key, d.id])) as OrgFixture["statusDefinitionIds"];

  return { org, owner, client, statusDefinitionIds };
}

async function cleanupOrg(fixture: OrgFixture): Promise<void> {
  await dbQuery("project", "deleteMany", { where: { organizationId: fixture.org.id } });
  await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixture.org.id } });
  await dbQuery("client", "deleteMany", { where: { organizationId: fixture.org.id } });
  await dbQuery("membership", "deleteMany", { where: { organizationId: fixture.org.id } });
  await dbQuery("subscription", "deleteMany", { where: { organizationId: fixture.org.id } });
  await dbQuery("organization", "delete", { where: { id: fixture.org.id } });
  await dbQuery("user", "delete", { where: { id: fixture.owner.id } });
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test("Billing page shows accurate Free-plan usage, including the active-project limit reached state", async ({ browser, baseURL }) => {
  const fixture = await createFreePlanOrg(`usage-${randomUUID().slice(0, 6)}`);
  try {
    for (let i = 0; i < 5; i++) {
      await dbQuery("project", "create", {
        data: {
          name: `Active ${i}`,
          clientId: fixture.client.id,
          ownerId: fixture.owner.id,
          organizationId: fixture.org.id,
          status: "IN_PROGRESS",
          statusDefinitionId: fixture.statusDefinitionIds.in_progress,
        },
      });
    }
    await dbQuery("project", "create", {
      data: {
        name: "Finished Work",
        clientId: fixture.client.id,
        ownerId: fixture.owner.id,
        organizationId: fixture.org.id,
        status: "COMPLETED",
        statusDefinitionId: fixture.statusDefinitionIds.completed,
      },
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await injectTestSession(context, fixture.owner, baseURL!);
      await page.goto("/settings/billing");
      await expect(page.getByText("1 of 2 used").first()).toBeVisible(); // Members
      await expect(page.getByText("1 of 25 used").first()).toBeVisible(); // Clients
      await expect(page.getByText("6 used").first()).toBeVisible(); // Projects (total, unlimited)
      await expect(page.getByText("5 of 5 used").first()).toBeVisible(); // Active projects
      await expect(page.getByText("Limit reached").first()).toBeVisible();
      await expect(page.getByText("0 B of 1.0 GB used").first()).toBeVisible(); // Storage
    } finally {
      await context.close();
    }
  } finally {
    await cleanupOrg(fixture);
  }
});

test("creating a 6th active project at the limit is blocked with a clear message, through the real form", async ({ browser, baseURL }) => {
  const fixture = await createFreePlanOrg(`blocked-${randomUUID().slice(0, 6)}`);
  try {
    for (let i = 0; i < 5; i++) {
      await dbQuery("project", "create", {
        data: {
          name: `Active ${i}`,
          clientId: fixture.client.id,
          ownerId: fixture.owner.id,
          organizationId: fixture.org.id,
          status: "IN_PROGRESS",
          statusDefinitionId: fixture.statusDefinitionIds.in_progress,
        },
      });
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await injectTestSession(context, fixture.owner, baseURL!);
      await page.goto("/projects/new");
      await page.getByLabel(/name/i).first().fill("Sixth Active Attempt");
      // This organization has exactly one Client — select it by position
      // rather than by label (the label includes a random test-run suffix).
      await page.locator('select[name="clientId"]').selectOption({ index: 1 });
      await page.getByRole("button", { name: /create project/i }).click();
      await expect(
        page.getByText("Your plan's active-project limit has been reached. Complete or cancel an existing active project before activating another."),
      ).toBeVisible();

      const projectCount = await dbQuery<number>("project", "count", { where: { organizationId: fixture.org.id } });
      expect(projectCount).toBe(5); // the 6th was never created
    } finally {
      await context.close();
    }
  } finally {
    await cleanupOrg(fixture);
  }
});

test("completed project history remains fully visible and editable alongside active projects", async ({ browser, baseURL }) => {
  const fixture = await createFreePlanOrg(`history-${randomUUID().slice(0, 6)}`);
  try {
    const finished = await dbQuery<{ id: string }>("project", "create", {
      data: {
        name: "Old Finished Work",
        clientId: fixture.client.id,
        ownerId: fixture.owner.id,
        organizationId: fixture.org.id,
        status: "COMPLETED",
        statusDefinitionId: fixture.statusDefinitionIds.completed,
      },
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await injectTestSession(context, fixture.owner, baseURL!);
      await page.goto("/projects");
      await expect(page.getByText("Old Finished Work").first()).toBeVisible();
      const finishedRow = page.locator("tr", { hasText: "Old Finished Work" });
      await expect(finishedRow.getByText("Completed")).toBeVisible();

      await page.goto(`/projects/${finished.id}/edit`);
      await expect(page.getByLabel(/name/i).first()).toHaveValue("Old Finished Work");
    } finally {
      await context.close();
    }
  } finally {
    await cleanupOrg(fixture);
  }
});

test("core Staff functionality (clients, invoices, tasks) stays reachable at the Free-plan client limit", async ({ browser, baseURL }) => {
  const fixture = await createFreePlanOrg(`core-${randomUUID().slice(0, 6)}`);
  try {
    await dbQuery("client", "createMany", {
      data: Array.from({ length: 24 }, (_, i) => ({
        name: `Existing ${i}`,
        userId: fixture.owner.id,
        organizationId: fixture.org.id,
      })),
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await injectTestSession(context, fixture.owner, baseURL!);
      await page.goto("/clients");
      await expect(page).toHaveURL(/\/clients/);
      await expect(page.getByText("25 clients")).toBeVisible();

      await page.goto("/invoices");
      await expect(page).toHaveURL(/\/invoices/);

      await page.goto("/tasks");
      await expect(page).toHaveURL(/\/tasks/);

      await page.goto("/documents");
      await expect(page).toHaveURL(/\/documents/);
    } finally {
      await context.close();
    }
  } finally {
    await cleanupOrg(fixture);
  }
});

test("reclassifying a custom Project status to 'active' is blocked when it would exceed the limit, and succeeds when it fits", async ({
  browser,
  baseURL,
}) => {
  const fixture = await createFreePlanOrg(`reclassify-${randomUUID().slice(0, 6)}`);
  try {
    for (let i = 0; i < 5; i++) {
      await dbQuery("project", "create", {
        data: {
          name: `Active ${i}`,
          clientId: fixture.client.id,
          ownerId: fixture.owner.id,
          organizationId: fixture.org.id,
          status: "IN_PROGRESS",
          statusDefinitionId: fixture.statusDefinitionIds.in_progress,
        },
      });
    }
    const customDef = await dbQuery<{ id: string }>("customStatusDefinition", "create", {
      data: {
        organizationId: fixture.org.id,
        entityType: "PROJECT",
        key: "backlog",
        label: "Backlog",
        color: "NEUTRAL",
        position: 10,
        isDefault: false,
        isSystem: false,
        countsAsActiveProject: false,
      },
    });
    await dbQuery("project", "create", {
      data: {
        name: "Backlogged",
        clientId: fixture.client.id,
        ownerId: fixture.owner.id,
        organizationId: fixture.org.id,
        status: "PLANNING",
        statusDefinitionId: customDef.id,
      },
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await injectTestSession(context, fixture.owner, baseURL!);
      await page.goto("/settings/custom-statuses?entity=PROJECT");
      await page.getByRole("button", { name: "Edit" }).first().click();
      await page.getByRole("radio", { name: /^Active/ }).check();
      await page.getByRole("button", { name: /save changes/i }).click();
      await expect(
        page.getByText(/active-project limit/i),
      ).toBeVisible();

      // The classification was never applied — the backlogged project
      // still doesn't count, confirmed by its own row's badge.
      const backlogRow = page.locator("tr", { hasText: "Backlog" });
      await expect(backlogRow.getByText("Doesn't count as active")).toBeVisible();
    } finally {
      await context.close();
    }
  } finally {
    await cleanupOrg(fixture);
  }
});
