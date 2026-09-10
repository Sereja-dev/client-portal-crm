import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Leads / Sales Pipeline Phase 3 — real-browser coverage for what
 * unit/integration tests structurally cannot exercise: the list page's
 * filters/empty-states, the create/edit forms' pending/error rendering,
 * the stage-move dropdown, the Mark Lost and duplicate-email
 * confirmation dialogs, and the Archive/Unarchive/Convert buttons'
 * visible states. Every backend edge case (org scoping, race safety,
 * entitlement enforcement, etc.) is already exhaustively covered in
 * test/integration/leads — this file deliberately does not repeat them.
 */

async function setActiveOrg(context: BrowserContext, baseURL: string, organizationId: string): Promise<void> {
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

async function actAsMember(
  context: BrowserContext,
  baseURL: string,
  user: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await setActiveOrg(context, baseURL, organizationId);
}

const NAME_PREFIX = "E2E-Lead";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

// Field-id-keyed, not label-text-keyed: every LeadForm input has a real,
// stable `id` attribute (id="name"/"company"/"email"/...) — selecting by
// that id directly is more robust than accessible-name matching for a
// plain form field, and sidesteps any accessible-name computation
// subtlety around the required-field asterisk marker entirely.
async function createLeadViaUI(page: Page, name: string, extra: Record<string, string> = {}) {
  await page.goto("/leads/new");
  await page.locator("#name").fill(name);
  for (const [fieldId, value] of Object.entries(extra)) {
    await page.locator(`#${fieldId}`).fill(value);
  }
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/leads$/);
}

// Custom Statuses Phase 2B — Completion Pass (Section G): the generic
// status <select> (lead-actions-panel.tsx) now sources its OPTIONS from
// this org's own real CustomStatusDefinition rows — with none
// bootstrapped (seedE2EFixtures()'s own org fixture is never
// auto-bootstrapped, see bootstrap.ts's own doc comment), that select
// renders with zero <option>s, making it unusable. Byte-for-byte copy of
// bootstrap.ts's own LEAD seed values, since this file is about the
// generic Lead UI, not Custom Statuses itself — reusing the real domain
// bootstrap function here would need a direct Prisma import this file
// deliberately doesn't have (see e2e-db-client.ts's own header comment).
async function bootstrapLeadStatuses(organizationId: string): Promise<void> {
  await dbQuery("customStatusDefinition", "createMany", {
    data: [
      { organizationId, entityType: "LEAD", key: "new", label: "New", color: "NEUTRAL", position: 0, isDefault: true, isSystem: true },
      { organizationId, entityType: "LEAD", key: "contacted", label: "Contacted", color: "INFO", position: 1, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "qualified", label: "Qualified", color: "INFO", position: 2, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "proposal", label: "Proposal", color: "INFO", position: 3, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "won", label: "Won", color: "SUCCESS", position: 4, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "lost", label: "Lost", color: "DANGER", position: 5, isDefault: false, isSystem: true },
    ],
  });
}

test.describe("Leads UI", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    await bootstrapLeadStatuses(fixtures.orgA.id);
  });

  test.afterAll(async () => {
    await dbQuery("lead", "deleteMany", { where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  test.describe("list page", () => {
    test("empty filtered search shows the filtered empty state, not the setup CTA", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto(`/leads?q=${randomUUID()}`);
      await expect(page.getByText("No leads match your filters")).toBeVisible();
      await expect(page.getByText("Add your first lead")).toHaveCount(0);
    });

    test("create, then find the lead in the list with its stage badge", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const name = uniqueName();

      await createLeadViaUI(page, name, { company: "Acme Co" });

      await page.goto(`/leads?q=${name}`);
      // Both the desktop table and the mobile RecordCardList render the
      // same row (only CSS-hidden at this viewport, not DOM-absent) —
      // .first() picks whichever is actually present at the default
      // (desktop-width) test viewport, avoiding a strict-mode collision.
      // Scoped to <table>/<ul> specifically so "New" never matches the
      // Stage filter <select>'s own <option value="NEW">New</option>,
      // which sorts earlier in the DOM (the filter bar renders above
      // the results).
      await expect(page.getByText(name).first()).toBeVisible();
      await expect(page.locator("table, ul").getByText("New", { exact: true }).first()).toBeVisible();
    });

    test("a foreign-org lead never appears in this org's list", async ({ page, context, baseURL }) => {
      const foreignName = uniqueName();
      await actAsMember(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
      await createLeadViaUI(page, foreignName);

      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto(`/leads?q=${foreignName}`);
      await expect(page.getByText("No leads match your filters")).toBeVisible();
    });
  });

  test.describe("create form", () => {
    test("a missing name shows a validation error and stays on the page", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/leads/new");
      // A literal empty value never reaches the server at all — the
      // input's own `required` attribute blocks native form submission
      // before any JS runs. A whitespace-only value passes that native
      // check (it's non-empty) but the server trims it to "" and
      // rejects it, exercising the real server-side validation path
      // this test means to cover.
      await page.locator("#name").fill("   ");
      await page.getByRole("button", { name: "Create lead" }).click();
      await expect(page.getByText("Name is required.")).toBeVisible();
      await expect(page).toHaveURL(/\/leads\/new$/);
    });

    test("a valid submission redirects to the list with a success toast", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const name = uniqueName();
      await createLeadViaUI(page, name, { email: `${name}@example.com` });
      await expect(page.getByText("Lead created")).toBeVisible();
    });

    test("the assignee dropdown only lists this organization's own Staff members", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/leads/new");
      const options = await page.getByLabel("Assignee").locator("option").allTextContents();
      expect(options).toContain(fixtures.owner.name);
      expect(options).not.toContain(fixtures.orgBOwner.name);
    });
  });

  test.describe("edit page", () => {
    test("a foreign-org lead id 404s", async ({ page, context, baseURL }) => {
      const foreignName = uniqueName();
      await actAsMember(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
      await createLeadViaUI(page, foreignName);
      const foreignLead = await dbQuery<{ id: string }>("lead", "findFirstOrThrow", { where: { name: foreignName } });

      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const response = await page.goto(`/leads/${foreignLead.id}/edit`);
      expect(response?.status()).toBe(404);
    });

    test("fields are populated from the existing lead", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const name = uniqueName();
      await createLeadViaUI(page, name, { company: "Populated Co" });
      const lead = await dbQuery<{ id: string }>("lead", "findFirstOrThrow", { where: { name } });

      await page.goto(`/leads/${lead.id}/edit`);
      await expect(page.locator("#name")).toHaveValue(name);
      await expect(page.locator("#company")).toHaveValue("Populated Co");
    });

    test("stage move updates the badge, and Mark Lost captures a reason", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const name = uniqueName();
      await createLeadViaUI(page, name);
      const lead = await dbQuery<{ id: string }>("lead", "findFirstOrThrow", { where: { name } });

      await page.goto(`/leads/${lead.id}/edit`);
      await page.getByLabel("Change status").selectOption({ label: "Qualified" });
      await expect(page.getByText("Status updated")).toBeVisible();
      await expect(page.getByText("Qualified", { exact: true }).first()).toBeVisible();

      await page.getByRole("button", { name: "Mark lost" }).click();
      await page.getByLabel("Reason (optional)").fill("Budget cut");
      await page.getByRole("button", { name: "Mark lost" }).nth(1).click();
      await expect(page.getByText("Lead marked lost")).toBeVisible();
      await expect(page.getByText("Lost", { exact: true }).first()).toBeVisible();

      const afterLost = await dbQuery<{ lostReason: string | null }>("lead", "findUniqueOrThrow", {
        where: { id: lead.id },
      });
      expect(afterLost.lostReason).toBe("Budget cut");

      // Reactivation via the same generic dropdown clears lostReason.
      // Waiting on the "Contacted" badge itself here, not the "Status
      // updated" toast: that toast's text is identical to the QUALIFIED
      // move's toast above, and toasts persist for several seconds, so
      // a stale one could still be visible and satisfy the assertion
      // before this second mutation has actually landed.
      await page.getByLabel("Change status").selectOption({ label: "Contacted" });
      await expect(page.getByText("Contacted", { exact: true }).first()).toBeVisible();
      const afterReactivate = await dbQuery<{ stage: string; lostReason: string | null }>("lead", "findUniqueOrThrow", {
        where: { id: lead.id },
      });
      expect(afterReactivate.stage).toBe("CONTACTED");
      expect(afterReactivate.lostReason).toBeNull();
    });

    test("archive removes the lead from the default list; unarchive restores it", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const name = uniqueName();
      await createLeadViaUI(page, name);
      const lead = await dbQuery<{ id: string }>("lead", "findFirstOrThrow", { where: { name } });

      await page.goto(`/leads/${lead.id}/edit`);
      await page.getByRole("button", { name: "Archive" }).click();
      await page.getByRole("button", { name: "Archive" }).nth(1).click();
      await expect(page.getByText("Lead archived")).toBeVisible();

      await page.goto(`/leads?q=${name}`);
      await expect(page.getByText("No leads match your filters")).toBeVisible();

      await page.goto(`/leads?q=${name}&archived=1`);
      // Same duplicated desktop-table/mobile-card-list DOM as the list
      // page tests above (only CSS-hidden, not DOM-absent) — .first()
      // avoids the strict-mode violation from matching both.
      await expect(page.getByText(name).first()).toBeVisible();
    });

    test("conversion happy path redirects to the new Client", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const name = uniqueName();
      await createLeadViaUI(page, name);
      const lead = await dbQuery<{ id: string }>("lead", "findFirstOrThrow", { where: { name } });

      await page.goto(`/leads/${lead.id}/edit`);
      await page.getByRole("button", { name: "Convert to client" }).click();
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+\/edit$/);
      await expect(page.locator("#name")).toHaveValue(name);

      await dbQuery("client", "deleteMany", { where: { name } });
    });

    test("duplicate email requires confirmation; Cancel converts nothing; Create anyway converts", async ({
      page,
      context,
      baseURL,
    }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const sharedEmail = `${uniqueName()}@example.com`;
      const existingClientName = uniqueName();
      await dbQuery("client", "create", {
        data: {
          name: existingClientName,
          email: sharedEmail,
          organizationId: fixtures.orgA.id,
          userId: fixtures.owner.id,
        },
      });

      const leadName = uniqueName();
      await createLeadViaUI(page, leadName, { email: sharedEmail });
      const lead = await dbQuery<{ id: string }>("lead", "findFirstOrThrow", { where: { name: leadName } });

      await page.goto(`/leads/${lead.id}/edit`);
      await page.getByRole("button", { name: "Convert to client" }).click();
      await expect(page.getByText("A client with this email already exists.")).toBeVisible();

      // Cancel converts nothing.
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page).toHaveURL(new RegExp(`/leads/${lead.id}/edit$`));
      const stillUnconverted = await dbQuery<{ convertedClientId: string | null }>("lead", "findUniqueOrThrow", {
        where: { id: lead.id },
      });
      expect(stillUnconverted.convertedClientId).toBeNull();

      // Create anyway converts.
      await page.getByRole("button", { name: "Convert to client" }).click();
      await expect(page.getByText("A client with this email already exists.")).toBeVisible();
      await page.getByRole("button", { name: "Create anyway" }).click();
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+\/edit$/);

      await dbQuery("client", "deleteMany", { where: { email: sharedEmail, organizationId: fixtures.orgA.id } });
    });

    test("a converted lead shows the locked/converted state and no Convert button", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const name = uniqueName();
      await createLeadViaUI(page, name);
      const lead = await dbQuery<{ id: string }>("lead", "findFirstOrThrow", { where: { name } });

      await page.goto(`/leads/${lead.id}/edit`);
      await page.getByRole("button", { name: "Convert to client" }).click();
      await expect(page).toHaveURL(/\/clients\//);

      await page.goto(`/leads/${lead.id}/edit`);
      await expect(page.getByText(/its stage is locked to Won/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Convert to client" })).toHaveCount(0);
      await expect(page.getByText("Won", { exact: true }).first()).toBeVisible();

      await dbQuery("client", "deleteMany", { where: { name } });
    });
  });
});
