import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectSearchableOption } from "../support/select-searchable-option";

/**
 * Forms Improvement Slice A2.2 — real-browser coverage for the new
 * searchable Client/Project selectors on Recurring Invoice create/edit.
 * No Recurring Invoice E2E spec existed before this slice (confirmed via
 * the A2 audit) — this file is the first, and stays scoped to exactly
 * what A2.2 changed: the relational selectors themselves, their
 * Client→Project dependency, and that every recurrence/numbering/
 * currency field is untouched by that interaction. Reuses A2.1's own
 * generic `selectSearchableOption` helper unmodified — it is already
 * domain-neutral.
 */

let fixtures: TestFixtures;
let secondClient: { id: string; name: string };
let secondProject: { id: string; name: string };
let thirdProjectUnderClientA: { id: string; name: string };
const extraScheduleIds: string[] = [];

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

function trackErrors(page: Page): { errors: () => string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return { errors: () => [...consoleErrors, ...pageErrors] };
}

function assertNoHydrationErrors(errors: string[]): void {
  const hydrationRelated = errors.filter((text) => /hydrat|#418|did not match|server-rendered/i.test(text));
  expect(hydrationRelated).toEqual([]);
}

test.describe("Forms Improvement Slice A2.2 — Recurring Invoice searchable Client/Project selectors", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();

    const createdClient = await dbQuery<{ id: string; name: string }>("client", "create", {
      data: {
        name: `A2.2 Second Client ${fixtures.runId}`,
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
      },
    });
    secondClient = { id: createdClient.id, name: createdClient.name };

    const createdProject = await dbQuery<{ id: string; name: string }>("project", "create", {
      data: {
        name: `A2.2 Second Project ${fixtures.runId}`,
        clientId: secondClient.id,
        ownerId: fixtures.owner.id,
        organizationId: fixtures.orgA.id,
      },
    });
    secondProject = { id: createdProject.id, name: createdProject.name };

    const createdThirdProject = await dbQuery<{ id: string; name: string }>("project", "create", {
      data: {
        name: `A2.2 Third Project (Client A) ${fixtures.runId}`,
        clientId: fixtures.clientA.id,
        ownerId: fixtures.owner.id,
        organizationId: fixtures.orgA.id,
      },
    });
    thirdProjectUnderClientA = { id: createdThirdProject.id, name: createdThirdProject.name };
  });

  test.afterAll(async () => {
    if (extraScheduleIds.length > 0) {
      await dbQuery("recurringInvoice", "deleteMany", { where: { id: { in: extraScheduleIds } } });
    }
    await dbQuery("project", "deleteMany", {
      where: { id: { in: [secondProject.id, thirdProjectUnderClientA.id] } },
    });
    await dbQuery("client", "deleteMany", { where: { id: secondClient.id } });
    await cleanupTestData(fixtures);
  });

  test("create: no Client preselected, Project disabled until Client chosen, searchable by name, Project options scoped to that Client, 'No project' selectable, Client change clears an invalid Project, and recurrence fields survive these interactions untouched", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    await page.goto("/recurring-invoices/new");

    const clientField = page.getByRole("combobox", { name: "Client" });
    const projectField = page.getByRole("combobox", { name: "Project" });

    // 2/3. no Client preselected; Project disabled until a Client exists.
    await expect(clientField).toHaveValue("");
    await expect(projectField).toBeDisabled();

    // A representative recurrence field, filled BEFORE any relation
    // interaction — proves relation selection never resets it.
    await page.getByLabel("Invoice number prefix").fill("A2-2-REC-");
    await page.getByLabel("Due date offset (days)").fill("15");

    // 4/5. searchable, select Client by name.
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await expect(clientField).toHaveValue(fixtures.clientA.name);

    // 6. Project becomes enabled.
    await expect(projectField).toBeEnabled();

    // 7. visible Project options belong only to the selected Client.
    await projectField.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByRole("option", { name: thirdProjectUnderClientA.name, exact: true })).toBeVisible();
    await expect(listbox.getByRole("option", { name: secondProject.name, exact: true })).toHaveCount(0);
    await expect(listbox.getByRole("option", { name: "No project", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // 8. search/select a Project.
    await selectSearchableOption(page, "Project", thirdProjectUnderClientA.name, thirdProjectUnderClientA.name);
    await expect(projectField).toHaveValue(thirdProjectUnderClientA.name);

    // 9. switch back to "No project".
    await selectSearchableOption(page, "Project", "No project", "No project");
    await expect(projectField).toHaveValue("No project");

    // 10. re-select a real Project, then change Client to one it does not
    // belong to — clears to "No project".
    await selectSearchableOption(page, "Project", thirdProjectUnderClientA.name, thirdProjectUnderClientA.name);
    await selectSearchableOption(page, "Client", secondClient.name, secondClient.name);
    await expect(projectField).toHaveValue("No project");

    // 11. the recurrence fields filled earlier are completely unaffected.
    await expect(page.getByLabel("Invoice number prefix")).toHaveValue("A2-2-REC-");
    await expect(page.getByLabel("Due date offset (days)")).toHaveValue("15");
    await expect(page.getByLabel("Frequency")).toHaveValue("MONTHLY");

    // 12. no hydration/runtime errors.
    assertNoHydrationErrors(tracker.errors());
  });

  test("create: re-selecting the same Client never clears an already-valid Project", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/recurring-invoices/new");

    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await selectSearchableOption(page, "Project", thirdProjectUnderClientA.name, thirdProjectUnderClientA.name);

    // Re-selecting the SAME Client — handleClientChange's own exact
    // re-validity check stays true, so the Project must not be cleared.
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);

    await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue(thirdProjectUnderClientA.name);
  });

  test("edit: persisted Client, Project, and every recurrence/numbering/currency field are preserved and correctly rendered, and changing Client updates only the dependent Project options without persisting anything until save", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    const invoiceNumberPrefix = `A2-2-EDIT-${Date.now()}-`;
    const schedule = await dbQuery<{ id: string }>("recurringInvoice", "create", {
      data: {
        name: "A2.2 edit schedule",
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        projectId: thirdProjectUnderClientA.id,
        frequency: "MONTHLY",
        anchorDay: 1,
        nextIssueDate: new Date(),
        invoiceNumberPrefix,
        nextSequence: 7,
        dueDateOffsetDays: 20,
        currency: "USD",
        status: "ACTIVE",
        lineItems: { create: [{ description: "Retainer", quantity: "1", unitPrice: "10.00", position: 0 }] },
      },
    });
    extraScheduleIds.push(schedule.id);

    await page.goto(`/recurring-invoices/${schedule.id}/edit`);

    const clientField = page.getByRole("combobox", { name: "Client" });
    const projectField = page.getByRole("combobox", { name: "Project" });

    // Persisted relation values render correctly on first load — no blank
    // flash, no silently-selected first option.
    await expect(clientField).toHaveValue(fixtures.clientA.name);
    await expect(projectField).toHaveValue(thirdProjectUnderClientA.name);

    // Persisted non-relational fields are untouched by this slice.
    await expect(page.getByLabel("Invoice number prefix")).toHaveValue(invoiceNumberPrefix);
    await expect(page.getByLabel("Due date offset (days)")).toHaveValue("20");

    // Changing Client updates dependent Project options (unsaved only).
    await selectSearchableOption(page, "Client", secondClient.name, secondClient.name);
    await expect(projectField).toHaveValue("No project");
    await projectField.click();
    await expect(page.getByRole("listbox").getByRole("option", { name: secondProject.name, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    const unchanged = await dbQuery<{ clientId: string; projectId: string | null; dueDateOffsetDays: number | null }>(
      "recurringInvoice",
      "findUniqueOrThrow",
      { where: { id: schedule.id } },
    );
    expect(unchanged.clientId).toBe(fixtures.clientA.id);
    expect(unchanged.projectId).toBe(thirdProjectUnderClientA.id);
    expect(unchanged.dueDateOffsetDays).toBe(20);

    assertNoHydrationErrors(tracker.errors());
  });

  test("390x900: Client and Project selectors fit the viewport, long option labels don't cause horizontal overflow, and recurrence fields remain usable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/recurring-invoices/new");

    const clientField = page.getByRole("combobox", { name: "Client" });
    await expect(clientField).toBeVisible();
    await clientField.click();
    await expect(page.getByRole("listbox")).toBeVisible();

    const overflowWhileOpen = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowWhileOpen).toBe(false);

    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);

    const projectField = page.getByRole("combobox", { name: "Project" });
    await expect(projectField).toBeEnabled();
    await selectSearchableOption(page, "Project", thirdProjectUnderClientA.name, thirdProjectUnderClientA.name);
    await expect(projectField).toHaveValue(thirdProjectUnderClientA.name);

    await expect(page.getByLabel("Invoice number prefix")).toBeVisible();
    await page.getByLabel("Invoice number prefix").fill("MOBILE-");
    await expect(page.getByLabel("Invoice number prefix")).toHaveValue("MOBILE-");

    const overflowAfter = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowAfter).toBe(false);
  });
});
