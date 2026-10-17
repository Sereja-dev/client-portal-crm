import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { testEmail, testSlug } from "../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../support/env";

/**
 * Recurring Invoices zero-Client prerequisite remediation. No general
 * list/create-flow E2E suite existed for Recurring Invoices before this
 * fix (confirmed by the dedicated audit) — this file is scoped to
 * exactly what this fix changed: the new prerequisite branch on both
 * /recurring-invoices and /recurring-invoices/new, and that the
 * existing filtered/first-time/normal-create paths are unaffected.
 * Per-field form behavior (relational selectors, validation reset,
 * form sections) already has its own dedicated coverage elsewhere and
 * is not re-derived here.
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

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Recurring Invoices — zero-Client prerequisite", () => {
  test("list: zero Clients shows the prerequisite state, no header CTA, no filter bar", async ({
    context,
    baseURL,
  }) => {
    const org = await dbQuery<{ id: string }>("organization", "create", {
      data: { name: "Fresh Recurring Prereq Org", slug: testSlug("recurring-prereq", fixtures.runId) },
    });
    const owner = await dbQuery<{ id: string; email: string }>("user", "create", {
      data: {
        id: randomUUID(),
        email: testEmail("recurring-prereq-owner", TEST_EMAIL_DOMAIN, fixtures.runId),
        name: "Recurring Prereq Owner",
      },
    });
    await dbQuery("membership", "create", { data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });

    try {
      await actAs(context, baseURL!, owner, org.id);
      const page = await context.newPage();
      await page.goto("/recurring-invoices");

      await expect(page.getByText("You need a client first")).toBeVisible();
      await expect(
        page.getByText("Recurring invoices must belong to a client. Add one before creating a schedule."),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Add client" })).toHaveAttribute("href", "/clients/new");

      await expect(page.getByRole("link", { name: "New schedule" })).toHaveCount(0);
      // The filter bar's own Status select is a stable, unambiguous
      // marker of its presence/absence.
      await expect(page.getByLabel("Status", { exact: true })).toHaveCount(0);

      await page.close();
    } finally {
      await dbQuery("membership", "deleteMany", { where: { userId: owner.id, organizationId: org.id } });
      await dbQuery("user", "deleteMany", { where: { id: owner.id } });
      await dbQuery("organization", "deleteMany", { where: { id: org.id } });
    }
  });

  test("direct /new: zero Clients shows the prerequisite state, the form is not rendered", async ({
    context,
    baseURL,
  }) => {
    const org = await dbQuery<{ id: string }>("organization", "create", {
      data: { name: "Fresh Recurring Prereq New Org", slug: testSlug("recurring-prereq-new", fixtures.runId) },
    });
    const owner = await dbQuery<{ id: string; email: string }>("user", "create", {
      data: {
        id: randomUUID(),
        email: testEmail("recurring-prereq-new-owner", TEST_EMAIL_DOMAIN, fixtures.runId),
        name: "Recurring Prereq New Owner",
      },
    });
    await dbQuery("membership", "create", { data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });

    try {
      await actAs(context, baseURL!, owner, org.id);
      const page = await context.newPage();
      await page.goto("/recurring-invoices/new");

      await expect(page.getByText("You need a client first")).toBeVisible();
      await expect(page.getByRole("link", { name: "Add client" })).toHaveAttribute("href", "/clients/new");
      // The form never renders at all -- no Client field, no submit control.
      await expect(page.getByRole("button", { name: "Create schedule" })).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Client" })).toHaveCount(0);

      await page.close();
    } finally {
      await dbQuery("membership", "deleteMany", { where: { userId: owner.id, organizationId: org.id } });
      await dbQuery("user", "deleteMany", { where: { id: owner.id } });
      await dbQuery("organization", "deleteMany", { where: { id: org.id } });
    }
  });

  test("regression: a Client-present organization sees the normal create form on /new", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
    await page.goto("/recurring-invoices/new");

    await expect(page.getByText("You need a client first")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "New recurring invoice" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Client" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create schedule" })).toBeVisible();
  });

  test("regression: a Client-present organization with zero schedules still shows the normal first-time list state", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
    await page.goto("/recurring-invoices");

    await expect(page.getByText("You need a client first")).toHaveCount(0);
    await expect(page.getByText("No recurring invoices yet")).toBeVisible();
    await expect(
      page.getByText("Create a schedule to automatically generate draft invoices on a recurring basis."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "New schedule" }).first()).toBeVisible();
  });

  test("regression: filtered-zero on a Client-present organization still shows the generic no-results state, not the prerequisite", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    // fixtures.clientB belongs to orgB, not orgA -- an always-empty,
    // deterministic client filter for orgA without needing a real schedule.
    await page.goto(`/recurring-invoices?clientId=${fixtures.clientB.id}`);

    await expect(page.getByText("No matching schedules")).toBeVisible();
    await expect(page.getByText("You need a client first")).toHaveCount(0);
  });
});
