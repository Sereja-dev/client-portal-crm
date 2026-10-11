import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectSearchableOption } from "../support/select-searchable-option";

/**
 * Forms Improvement Slice A2.3 — real-browser coverage for the new
 * searchable Client selector inside Quote's own Client target branch.
 * Per-field create/list/lifecycle/SENT-live/template coverage for Quote
 * already exists elsewhere (quotes.spec.ts, quote-apply-flow.spec.ts —
 * both retargeted alongside this slice to drive the Client branch via the
 * new combobox instead of the retired native <select>, and both already
 * proved the DRAFT/SENT-live edit flows still submit successfully with
 * the new control embedded); this file adds the explicit assertions
 * those files don't make — the selector's own displayed value, the
 * Lead<->Client target-switch semantics, and that a persisted Client
 * renders correctly in the searchable control on first load.
 */

let fixtures: TestFixtures;
let secondClient: { id: string; name: string };
const extraQuoteIds: string[] = [];
const extraLeadIds: string[] = [];

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

test.describe("Forms Improvement Slice A2.3 — Quote searchable Client target selector", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    const created = await dbQuery<{ id: string; name: string }>("client", "create", {
      data: {
        name: `A2.3 Second Client ${fixtures.runId}`,
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
      },
    });
    secondClient = { id: created.id, name: created.name };
  });

  test.afterAll(async () => {
    if (extraQuoteIds.length > 0) {
      // Quotes first — Quote.leadId is onDelete: Restrict, so deleting a
      // referenced Lead before its Quote violates the FK constraint.
      await dbQuery("quote", "deleteMany", { where: { id: { in: extraQuoteIds } } });
    }
    if (extraLeadIds.length > 0) {
      await dbQuery("lead", "deleteMany", { where: { id: { in: extraLeadIds } } });
    }
    await dbQuery("client", "deleteMany", { where: { id: secondClient.id } });
    await cleanupTestData(fixtures);
  });

  test("create: target radio still works, no Client preselected, searchable Client selector appears only in the Client branch, search/select works, switching to Lead clears Client and switching back never leaks a stale Lead id, unrelated fields stable, no hydration error", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    await page.goto("/quotes/new");

    // 2/3. target radio works; no Client control exists until "Client" is chosen.
    await expect(page.getByRole("combobox", { name: "Select client" })).toHaveCount(0);

    // A representative unrelated field, filled before any target interaction.
    await page.getByLabel("Quote number").fill(`A2-3-${fixtures.runId}`);

    await page.getByRole("radio", { name: "Client" }).check();

    // 4/5. the searchable Client control now exists, with nothing preselected.
    const clientField = page.getByRole("combobox", { name: "Select client" });
    await expect(clientField).toBeVisible();
    await expect(clientField).toHaveValue("");

    // 6/7/8. search by name, select, displays correctly.
    await selectSearchableOption(page, "Select client", fixtures.clientA.name, fixtures.clientA.name);
    await expect(clientField).toHaveValue(fixtures.clientA.name);

    // 9/10. switch to Lead target — the Client control disappears
    // entirely (it's conditionally rendered, never merely disabled), and
    // the Lead branch's own native select appears, untouched.
    await page.getByRole("radio", { name: "Lead" }).check();
    await expect(page.getByRole("combobox", { name: "Select client" })).toHaveCount(0);
    await expect(page.getByLabel("Select lead")).toBeVisible();

    // 11. Lead branch still works (native select, unmodified by this slice).
    // 12. switch back to Client — no stale Lead state leaks into the
    // Client control; it starts empty again, not auto-filled.
    await page.getByRole("radio", { name: "Client" }).check();
    const clientFieldAgain = page.getByRole("combobox", { name: "Select client" });
    await expect(clientFieldAgain).toBeVisible();
    await expect(clientFieldAgain).toHaveValue("");

    // 13. the unrelated field filled earlier is untouched by any of this.
    await expect(page.getByLabel("Quote number")).toHaveValue(`A2-3-${fixtures.runId}`);

    // 14. no hydration/runtime errors.
    assertNoHydrationErrors(tracker.errors());
  });

  test("create: typing a nonexistent Client name shows the empty-search message without selecting anything", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/quotes/new");
    await page.getByRole("radio", { name: "Client" }).check();

    const clientField = page.getByRole("combobox", { name: "Select client" });
    await clientField.click();
    await clientField.fill("zzz-no-such-client");
    await expect(page.getByText("No matching clients")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(clientField).toHaveValue("");
  });

  test("DRAFT edit: a persisted Client-target Quote opens with the searchable Client selector correctly reflecting the stored Client, and an unsaved Client change never persists", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    const quote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number: `A2-3-EDIT-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        status: "DRAFT",
        issueDate: new Date(),
        subtotal: "10.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "10.00",
        items: { create: [{ description: "Design", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", position: 0 }] },
      },
    });
    extraQuoteIds.push(quote.id);

    await page.goto(`/quotes/${quote.id}/edit`);

    // Client radio is pre-checked (persisted targetType), and the
    // searchable control shows the persisted Client immediately — no
    // blank flash, no silently-selected first option.
    await expect(page.getByRole("radio", { name: "Client" })).toBeChecked();
    const clientField = page.getByRole("combobox", { name: "Select client" });
    await expect(clientField).toHaveValue(fixtures.clientA.name);

    // Unsaved change — local state only.
    await selectSearchableOption(page, "Select client", secondClient.name, secondClient.name);
    await expect(clientField).toHaveValue(secondClient.name);

    const unchanged = await dbQuery<{ clientId: string | null }>("quote", "findUniqueOrThrow", {
      where: { id: quote.id },
    });
    expect(unchanged.clientId).toBe(fixtures.clientA.id);

    assertNoHydrationErrors(tracker.errors());
  });

  test("DRAFT edit: a persisted Lead-target Quote opens with the native Lead select, never renders the Client searchable control, and submits no Client id", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { name: `A2.3 Lead ${fixtures.runId}`, organizationId: fixtures.orgA.id },
    });

    const quote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number: `A2-3-LEAD-EDIT-${Date.now()}`,
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        leadId: lead.id,
        status: "DRAFT",
        issueDate: new Date(),
        subtotal: "10.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "10.00",
        items: { create: [{ description: "Consulting", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", position: 0 }] },
      },
    });
    extraQuoteIds.push(quote.id);
    extraLeadIds.push(lead.id);

    await page.goto(`/quotes/${quote.id}/edit`);

    await expect(page.getByRole("radio", { name: "Lead" })).toBeChecked();
    // The native, unmodified <select> is still value-by-id, unlike the
    // new searchable Client control's value-by-label display.
    await expect(page.getByLabel("Select lead")).toHaveValue(lead.id);
    await expect(page.getByRole("combobox", { name: "Select client" })).toHaveCount(0);

    // Save unchanged — the Lead target survives, no Client id was ever introduced.
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/quotes(\?|$)/);
    const saved = await dbQuery<{ leadId: string | null; clientId: string | null }>("quote", "findUniqueOrThrow", {
      where: { id: quote.id },
    });
    expect(saved.leadId).toBe(lead.id);
    expect(saved.clientId).toBeNull();
  });

  test("390x900: the Client searchable selector fits the viewport and the target radio remains usable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/quotes/new");

    await page.getByRole("radio", { name: "Client" }).check();
    const clientField = page.getByRole("combobox", { name: "Select client" });
    await expect(clientField).toBeVisible();
    await clientField.click();
    await expect(page.getByRole("listbox")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    await selectSearchableOption(page, "Select client", fixtures.clientA.name, fixtures.clientA.name);
    await expect(clientField).toHaveValue(fixtures.clientA.name);
    await expect(page.getByRole("radio", { name: "Lead" })).toBeEnabled();
  });
});
