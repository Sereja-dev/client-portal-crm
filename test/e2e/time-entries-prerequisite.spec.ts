import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { testEmail, testSlug } from "../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../support/env";

/**
 * Time Entries zero-Project prerequisite remediation. No general list/
 * create-flow suite existed for this exact scenario before this fix
 * (per-field/historical-Task behavior already has its own dedicated
 * coverage in test/e2e/time-entries.spec.ts and is not re-derived
 * here). The central invariant this file protects: TimeEntry.projectId
 * is nullable with onDelete: SetNull (unlike every sibling prerequisite
 * -- Tasks/Invoices/Contracts/Recurring Invoices all use a required FK
 * with Cascade/Restrict), so a zero-current-Project organization can
 * still hold genuine historical TimeEntry rows that must never be
 * hidden behind the new prerequisite state.
 */

let fixtures: TestFixtures;

async function actAs(
  context: BrowserContext,
  baseURL: string,
  identity: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, identity, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: organizationId,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function createFreshOrg(
  runId: string,
  label: string,
): Promise<{ orgId: string; owner: { id: string; email: string } }> {
  const org = await dbQuery<{ id: string }>("organization", "create", {
    data: { name: `Fresh Time Prereq ${label}`, slug: testSlug(`time-prereq-${label}`, runId) },
  });
  const owner = await dbQuery<{ id: string; email: string }>("user", "create", {
    data: {
      id: randomUUID(),
      email: testEmail(`time-prereq-${label}-owner`, TEST_EMAIL_DOMAIN, runId),
      name: `Time Prereq ${label} Owner`,
    },
  });
  await dbQuery("membership", "create", { data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  return { orgId: org.id, owner };
}

async function destroyOrg(orgId: string, ownerId: string): Promise<void> {
  await dbQuery("timeEntry", "deleteMany", { where: { organizationId: orgId } });
  await dbQuery("project", "deleteMany", { where: { organizationId: orgId } });
  await dbQuery("client", "deleteMany", { where: { organizationId: orgId } });
  await dbQuery("membership", "deleteMany", { where: { userId: ownerId, organizationId: orgId } });
  await dbQuery("user", "deleteMany", { where: { id: ownerId } });
  await dbQuery("organization", "deleteMany", { where: { id: orgId } });
}

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Time Entries — zero-Project prerequisite", () => {
  test("direct /time/new: zero Projects shows the prerequisite state, the form is not rendered", async ({
    context,
    baseURL,
  }) => {
    const { orgId, owner } = await createFreshOrg(fixtures.runId, "new");
    try {
      await actAs(context, baseURL!, owner, orgId);
      const page = await context.newPage();
      await page.goto("/time/new");

      await expect(page.getByText("You need a project first")).toBeVisible();
      await expect(
        page.getByText("Time entries must belong to a project. Add one before logging time."),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Add project" })).toHaveAttribute("href", "/projects/new");

      await expect(page.getByRole("combobox", { name: "Project" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Log time" })).toHaveCount(0);

      await page.close();
    } finally {
      await destroyOrg(orgId, owner.id);
    }
  });

  test("regression: a Project-present organization sees the normal create form on /new", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/time/new");

    await expect(page.getByText("You need a project first")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Log time" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Project" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log time" })).toBeVisible();
  });

  test("list: zero Projects and zero entries shows the prerequisite state; header Log time is absent; the filter bar remains visible", async ({
    context,
    baseURL,
  }) => {
    const { orgId, owner } = await createFreshOrg(fixtures.runId, "list");
    try {
      await actAs(context, baseURL!, owner, orgId);
      const page = await context.newPage();
      await page.goto("/time");

      await expect(page.getByText("You need a project first")).toBeVisible();
      await expect(
        page.getByText("Time entries must belong to a project. Add one before logging time."),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Add project" })).toHaveAttribute("href", "/projects/new");

      await expect(page.getByRole("link", { name: "Log time" })).toHaveCount(0);

      // Critical: the filter bar stays rendered -- historical,
      // now-orphaned entries (see the dedicated test below) must remain
      // filterable by date/member/billable even with zero current
      // Projects. "From" is a stable, always-present filter field.
      await expect(page.getByLabel("From", { exact: true })).toBeVisible();

      await page.close();
    } finally {
      await destroyOrg(orgId, owner.id);
    }
  });

  test("regression: a Project-present organization with zero entries still shows the normal first-time list state", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/time");

    await expect(page.getByText("You need a project first")).toHaveCount(0);
    await expect(page.getByText("No time entries yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Log time" }).first()).toBeVisible();
  });

  test("regression: filtered-zero still shows the generic no-results state, not the prerequisite", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/time?billable=true");

    await expect(page.getByText("No matching time entries")).toBeVisible();
    await expect(page.getByText("You need a project first")).toHaveCount(0);
  });

  test("regression: archived-empty still shows the existing archived state, not the prerequisite", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/time?archived=1");

    await expect(page.getByText("No archived time entries")).toBeVisible();
    await expect(page.getByText("You need a project first")).toHaveCount(0);
  });

  test("historical orphan safety: a TimeEntry whose Project was later deleted remains visible, never shadowed by the prerequisite", async ({
    context,
    baseURL,
  }) => {
    const { orgId, owner } = await createFreshOrg(fixtures.runId, "orphan");
    const client = await dbQuery<{ id: string }>("client", "create", {
      data: { name: "Orphan Test Client", organizationId: orgId, userId: owner.id },
    });
    const project = await dbQuery<{ id: string }>("project", "create", {
      data: { name: "Orphan Test Project", clientId: client.id, organizationId: orgId, ownerId: owner.id, status: "PLANNING" },
    });
    const entry = await dbQuery<{ id: string }>("timeEntry", "create", {
      data: {
        organizationId: orgId,
        userId: owner.id,
        projectId: project.id,
        workDate: "2026-03-15T00:00:00.000Z",
        durationMinutes: 60,
        billable: true,
      },
    });

    // Mirrors test/integration/time-entries/cascade.test.ts's own item
    // 45 exactly: deleting the Project sets TimeEntry.projectId to null
    // (onDelete: SetNull) -- the entry itself is never deleted.
    await dbQuery("project", "delete", { where: { id: project.id } });
    const survivingEntry = await dbQuery<{ projectId: string | null }>("timeEntry", "findUniqueOrThrow", {
      where: { id: entry.id },
    });
    expect(survivingEntry.projectId).toBeNull();

    try {
      await actAs(context, baseURL!, owner, orgId);
      const page = await context.newPage();
      await page.goto("/time");

      // Zero CURRENT Projects, but a genuine historical row exists --
      // the table must render it, and the prerequisite must NOT appear.
      // 60 minutes normalizes to "1h" (formatDurationMinutes) -- a
      // stable, unique marker for this fresh org's own single entry.
      await expect(page.getByText("You need a project first")).toHaveCount(0);
      await expect(page.getByRole("row", { name: /1h/ })).toBeVisible();

      await page.close();
    } finally {
      await dbQuery("timeEntry", "deleteMany", { where: { id: entry.id } });
      await destroyOrg(orgId, owner.id);
    }
  });
});
