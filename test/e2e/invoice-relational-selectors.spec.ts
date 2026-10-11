import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectSearchableOption } from "../support/select-searchable-option";

/**
 * Forms Improvement Slice A2.1 — real-browser coverage for the new
 * searchable Client/Project selectors on Invoice create/edit. Per-field
 * CRUD/lifecycle/duplicate/responsive coverage for Invoice already exists
 * elsewhere (invoices.spec.ts, invoice-live-preview.spec.ts,
 * invoice-apply-flow.spec.ts — all updated alongside this slice to drive
 * the new control instead of the retired native `<select>`); this file
 * covers only what's new: typing to filter, the Client→Project dependency
 * (filtering/preserving/clearing), "No project" as an explicit option,
 * persisted edit values, duplicate-flow prefill, and mobile sanity.
 */

let fixtures: TestFixtures;
let secondClient: { id: string; name: string };
let secondProject: { id: string; name: string };
let thirdProjectUnderClientA: { id: string; name: string };
const extraInvoiceIds: string[] = [];

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

test.describe("Forms Improvement Slice A2.1 — Invoice searchable Client/Project selectors", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();

    const createdClient = await dbQuery<{ id: string; name: string }>("client", "create", {
      data: {
        name: `A2.1 Second Client ${fixtures.runId}`,
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
      },
    });
    secondClient = { id: createdClient.id, name: createdClient.name };

    const createdProject = await dbQuery<{ id: string; name: string }>("project", "create", {
      data: {
        name: `A2.1 Second Project ${fixtures.runId}`,
        clientId: secondClient.id,
        ownerId: fixtures.owner.id,
        organizationId: fixtures.orgA.id,
      },
    });
    secondProject = { id: createdProject.id, name: createdProject.name };

    const createdThirdProject = await dbQuery<{ id: string; name: string }>("project", "create", {
      data: {
        name: `A2.1 Third Project (Client A) ${fixtures.runId}`,
        clientId: fixtures.clientA.id,
        ownerId: fixtures.owner.id,
        organizationId: fixtures.orgA.id,
      },
    });
    thirdProjectUnderClientA = { id: createdThirdProject.id, name: createdThirdProject.name };
  });

  test.afterAll(async () => {
    if (extraInvoiceIds.length > 0) {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: extraInvoiceIds } } });
    }
    await dbQuery("project", "deleteMany", {
      where: { id: { in: [secondProject.id, thirdProjectUnderClientA.id] } },
    });
    await dbQuery("client", "deleteMany", { where: { id: secondClient.id } });
    await cleanupTestData(fixtures);
  });

  test("create: no Client preselected, searchable by name, Project enabled only after Client, options scoped to that Client, 'No project' selectable, and Client change clears an invalid Project", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    await page.goto("/invoices/new");

    const clientField = page.getByRole("combobox", { name: "Client" });
    const projectField = page.getByRole("combobox", { name: "Project" });

    // 2. no Client preselected.
    await expect(clientField).toHaveValue("");
    // 10 (disabled half) — Project stays disabled until a Client exists.
    await expect(projectField).toBeDisabled();

    // 3/4/5. searchable selector opens, search known Client by name, select it.
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await expect(clientField).toHaveValue(fixtures.clientA.name);

    // 6. Project becomes enabled.
    await expect(projectField).toBeEnabled();

    // 7. visible Project options belong only to the selected Client — the
    // other Client's own Project (secondProject) must never appear.
    await projectField.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByRole("option", { name: fixtures.project.name, exact: true })).toBeVisible();
    await expect(listbox.getByRole("option", { name: thirdProjectUnderClientA.name, exact: true })).toBeVisible();
    await expect(listbox.getByRole("option", { name: secondProject.name, exact: true })).toHaveCount(0);
    // "No project" is present and explicit, not merely the empty state.
    await expect(listbox.getByRole("option", { name: "No project", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // 8. search/select a Project.
    await selectSearchableOption(page, "Project", fixtures.project.name, fixtures.project.name);
    await expect(projectField).toHaveValue(fixtures.project.name);

    // 9. switch back to "No project" — a real, explicit option, not a
    // disabled/placeholder state.
    await selectSearchableOption(page, "Project", "No project", "No project");
    await expect(projectField).toHaveValue("No project");

    // Re-select a real Project, then change Client to one it does NOT
    // belong to — current handleClientChange semantics clear it.
    await selectSearchableOption(page, "Project", fixtures.project.name, fixtures.project.name);
    await expect(projectField).toHaveValue(fixtures.project.name);

    await selectSearchableOption(page, "Client", secondClient.name, secondClient.name);
    await expect(projectField).toHaveValue("No project");

    assertNoHydrationErrors(tracker.errors());
  });

  test("create: changing Client preserves the current Project when it still belongs to the newly chosen Client", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/invoices/new");

    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await selectSearchableOption(page, "Project", thirdProjectUnderClientA.name, thirdProjectUnderClientA.name);

    // Re-selecting the SAME Client (handleClientChange's own exact
    // re-validity check: `projects.some(p => p.id === projectId &&
    // p.clientId === nextClientId)` is true here, since the Project
    // genuinely still belongs to this exact Client) must never clear an
    // already-valid Project — traced from invoice-form.tsx's own code,
    // not inferred from the UI. (An intermediate switch to a DIFFERENT
    // Client the Project does NOT belong to is a separate, already-
    // covered scenario — see the previous test — and does clear it; this
    // test is deliberately the one case where nothing should change.)
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);

    await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue(thirdProjectUnderClientA.name);
  });

  test("edit: persisted Client and Project are preserved and correctly selected, and changing Client updates the dependent Project options without mutating anything until an explicit save", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    const draft = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `A2-1-EDIT-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        projectId: fixtures.project.id,
        amount: "75.00",
        subtotal: "75.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        currency: "USD",
        status: "DRAFT",
        issueDate: new Date(),
      },
    });
    extraInvoiceIds.push(draft.id);

    await page.goto(`/invoices/${draft.id}/edit`);

    const clientField = page.getByRole("combobox", { name: "Client" });
    const projectField = page.getByRole("combobox", { name: "Project" });

    // Persisted values render correctly on first load — no blank flash,
    // no silently-selected first option.
    await expect(clientField).toHaveValue(fixtures.clientA.name);
    await expect(projectField).toHaveValue(fixtures.project.name);

    // Changing Client updates the dependent Project options (to that
    // Client's own) — purely unsaved, in-browser state until Save.
    await selectSearchableOption(page, "Client", secondClient.name, secondClient.name);
    await expect(projectField).toHaveValue("No project");
    await projectField.click();
    await expect(page.getByRole("listbox").getByRole("option", { name: secondProject.name, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // Nothing persisted yet from this unsaved interaction.
    const unchanged = await dbQuery<{ clientId: string; projectId: string | null }>("invoice", "findUniqueOrThrow", {
      where: { id: draft.id },
    });
    expect(unchanged.clientId).toBe(fixtures.clientA.id);
    expect(unchanged.projectId).toBe(fixtures.project.id);

    assertNoHydrationErrors(tracker.errors());
  });

  test("duplicate: the source Invoice's Client and Project are both correctly prefilled on the duplicate form", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const source = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: `A2-1-DUP-SRC-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        projectId: fixtures.project.id,
        amount: "60.00",
        subtotal: "60.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        currency: "USD",
        status: "CANCELLED",
        issueDate: new Date(),
      },
    });
    extraInvoiceIds.push(source.id);

    await page.goto(`/invoices/${source.id}/duplicate`);

    await expect(page.getByRole("combobox", { name: "Client" })).toHaveValue(fixtures.clientA.name);
    await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue(fixtures.project.name);
  });

  test("390x900: Client and Project selectors fit the viewport, long option labels don't cause horizontal overflow, options remain tappable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/invoices/new");

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

    const overflowAfter = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowAfter).toBe(false);
  });
});
