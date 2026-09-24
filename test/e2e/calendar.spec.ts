import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, openSidebarGroup, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

// Rendered by a Server Component, in the Node.js process running the
// app, via a bare `.toLocaleDateString(undefined, ...)` — this app's own
// established, deliberate convention (matches formatDateOnlyForDisplay's
// own identical choice) of always deferring to the runtime's own default
// locale rather than hardcoding one. The expected string is therefore
// computed here with the exact same expression production uses (see
// test/e2e/invoices.spec.ts's own identical "date-only display — no
// local-timezone drift" precedent) rather than a hardcoded English
// string, which would be wrong on any non-English-locale host (this one
// included).
function expectedMonthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { timeZone: "UTC", month: "long", year: "numeric" });
}

/**
 * Calendar V1 — Staff-only Month/Agenda calendar with manual events and
 * the read-only Invoice due-date overlay. Real browser coverage for
 * navigation, Month/Agenda rendering, create/edit/archive/restore, DST
 * validation surfacing, and responsive behavior at 390/834/1280px.
 * Domain-layer correctness (tenant isolation, target/assignee
 * revalidation, DST resolution, Activity, bounded queries) is already
 * exhaustively covered by test/integration/calendar-events/*.test.ts and
 * is not re-derived here.
 */

let fixtures: TestFixtures;

async function actAs(context: BrowserContext, baseURL: string, identity: { id: string; email: string }, organizationId: string): Promise<void> {
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

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await actAs(context, baseURL, fixtures.owner, fixtures.orgA.id);
}

async function actAsPortalUser(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL);
}

async function cleanupCalendarEvents(): Promise<void> {
  await dbQuery("calendarEvent", "deleteMany", { where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return dbQuery<{ id: string; title: string }>("calendarEvent", "create", {
    data: {
      title: `Kickoff ${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
      allDay: false,
      startsAt: "2026-06-15T14:00:00.000Z",
      organizationId: fixtures.orgA.id,
      createdByUserId: fixtures.owner.id,
      ...overrides,
    },
  });
}

test.describe("Calendar V1", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupCalendarEvents();
    await cleanupTestData(fixtures);
  });

  test.afterEach(async () => {
    await cleanupCalendarEvents();
  });

  test.describe("A. Navigation", () => {
    test("Calendar nav link exists for Staff and opens the current month", async ({ context, baseURL, page }) => {
      await actAsOwner(context, baseURL!);
      await page.goto("/dashboard");
      const nav = page.getByRole("navigation", { name: "Primary" });
      // Sidebar Information Architecture — Calendar now lives inside the
      // Work group (a native <details>/<summary> disclosure).
      await openSidebarGroup(nav, "Work");
      await nav.getByRole("link", { name: "Calendar" }).click();
      await expect(page).toHaveURL(/\/calendar$/);
      await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    });

    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      test(`${role} can view the Calendar (no privileged gate)`, async ({ context, baseURL, page }) => {
        const identity = role === "OWNER" ? fixtures.owner : role === "ADMIN" ? fixtures.admin : fixtures.member;
        await actAs(context, baseURL!, identity, fixtures.orgA.id);
        await page.goto("/calendar");
        await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
        await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
      });
    }

    test("no Portal Calendar nav or route exists", async ({ context, baseURL, page }) => {
      await actAsPortalUser(context, baseURL!);
      await page.goto("/portal");
      await expect(page.locator('a[href*="calendar"]')).toHaveCount(0);

      const response = await page.goto("/portal/calendar");
      expect(response?.status()).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe("B. Month view", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("a manual event is visible, and an Invoice due-date overlay item is visible and read-only", async ({ page }) => {
      const event = await seedEvent({ startsAt: "2026-06-15T14:00:00.000Z", title: "Client kickoff call" });
      const invoice = await dbQuery<{ id: string; invoiceNumber: string }>("invoice", "create", {
        data: {
          invoiceNumber: `E2E-CAL-INV-${Date.now()}`,
          status: "SENT",
          amount: "500.00",
          subtotal: "500.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          issueDate: "2026-06-01T00:00:00.000Z",
          dueDate: "2026-06-20T00:00:00.000Z",
          clientId: fixtures.clientA.id,
          organizationId: fixtures.orgA.id,
        },
      });
      try {
        await page.goto("/calendar?y=2026&m=6");
        await expect(page.getByText(expectedMonthLabel(2026, 6))).toBeVisible();
        await expect(page.getByRole("button", { name: new RegExp(event.title) })).toBeVisible();
        await expect(page.getByRole("link", { name: new RegExp(invoice.invoiceNumber) })).toBeVisible();

        // Clicking the invoice overlay navigates to the Staff Invoice
        // detail route -- it must never open the CalendarEvent dialog.
        await page.getByRole("link", { name: new RegExp(invoice.invoiceNumber) }).click();
        await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}/edit`));
        await expect(page.getByRole("dialog")).toHaveCount(0);
      } finally {
        await dbQuery("invoice", "deleteMany", { where: { id: invoice.id } });
      }
    });

    test("previous/next/today navigation changes the displayed month", async ({ page }) => {
      await page.goto("/calendar?y=2026&m=6");
      await expect(page.getByText(expectedMonthLabel(2026, 6))).toBeVisible();
      await page.getByRole("link", { name: "Next month" }).click();
      await expect(page.getByText(expectedMonthLabel(2026, 7))).toBeVisible();
      await page.getByRole("link", { name: "Previous month" }).click();
      await page.getByRole("link", { name: "Previous month" }).click();
      await expect(page.getByText(expectedMonthLabel(2026, 5))).toBeVisible();
      await page.getByRole("link", { name: "Today" }).click();
      await expect(page).toHaveURL(/\/calendar\?y=\d+&m=\d+/);
    });
  });

  test.describe("C. Create", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("creates an all-day event", async ({ page }) => {
      await page.goto("/calendar?y=2026&m=6");
      await page.getByRole("button", { name: "New event" }).click();
      await page.getByLabel("Title").fill("Company holiday");
      await page.getByLabel("All day").check();
      await page.getByLabel("Date").fill("2026-06-19");
      await page.getByRole("button", { name: "Save event", exact: true }).click();
      await expect(page.getByText("Event created")).toBeVisible();
      await expect(page.getByRole("button", { name: /Company holiday/ })).toBeVisible();
    });

    test("creates a timed event with a target, an assignee, and a location/description", async ({ page }) => {
      await page.goto("/calendar?y=2026&m=6");
      await page.getByRole("button", { name: "New event" }).click();
      await page.getByLabel("Title").fill("Discovery call");
      await page.getByLabel("Date").fill("2026-06-22");
      await page.getByLabel("Start time").fill("10:00");
      await page.getByLabel("End time").fill("10:30");
      await page.getByLabel("Related to").selectOption("CLIENT");
      await page.getByLabel("Client").selectOption(fixtures.clientA.id);
      await page.getByLabel("Assigned to").selectOption(fixtures.owner.id);
      await page.getByLabel("Location").fill("Zoom");
      await page.getByLabel("Description").fill("Intro call with the client.");
      await page.getByRole("button", { name: "Save event", exact: true }).click();
      await expect(page.getByText("Event created")).toBeVisible();
      await expect(page.getByRole("button", { name: /Discovery call/ })).toBeVisible();
    });
  });

  test.describe("D. Edit", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("opens a manual event, updates its title/time/target, and the change persists", async ({ page }) => {
      const event = await seedEvent({ startsAt: "2026-06-10T09:00:00.000Z", title: "Original title" });
      await page.goto("/calendar?y=2026&m=6");
      await page.getByRole("button", { name: new RegExp(event.title) }).click();
      await expect(page.getByRole("heading", { name: "Edit event" })).toBeVisible();
      await page.getByLabel("Title").fill("Updated title");
      await page.getByLabel("Start time").fill("15:00");
      await page.getByLabel("Related to").selectOption("PROJECT");
      await page.getByLabel("Project").selectOption(fixtures.project.id);
      await page.getByRole("button", { name: "Save event", exact: true }).click();
      await expect(page.getByText("Event updated")).toBeVisible();
      await expect(page.getByRole("button", { name: /Updated title/ })).toBeVisible();
    });
  });

  test.describe("E. Archive / restore", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("archiving removes the event from the normal Calendar view, and restoring returns it", async ({ page }) => {
      const event = await seedEvent({ startsAt: "2026-06-12T09:00:00.000Z", title: "To be archived" });
      await page.goto("/calendar?y=2026&m=6");
      await page.getByRole("button", { name: new RegExp(event.title) }).click();
      await page.getByRole("button", { name: "Archive event" }).click();
      // Two "Archive event" buttons now exist in the accessibility tree
      // (the trigger inside the still-open edit dialog, and the nested
      // ConfirmDialog's own confirm button) -- the confirm dialog's own
      // is the one rendered last, matching this app's own established
      // ".nth(1)"-after-open convention for a second stacked dialog
      // (see test/e2e/contracts.spec.ts's own identical pattern).
      await page.getByRole("button", { name: "Archive event", exact: true }).last().click();
      await expect(page.getByText("Event archived")).toBeVisible();
      await expect(page.getByRole("button", { name: new RegExp(event.title) })).toHaveCount(0);

      await page.goto("/calendar?view=archived&y=2026&m=6");
      await expect(page.getByText(event.title)).toBeVisible();
      await page.getByRole("button", { name: "Restore" }).click();
      await expect(page.getByText("Event restored")).toBeVisible();

      await page.goto("/calendar?y=2026&m=6");
      await expect(page.getByRole("button", { name: new RegExp(event.title) })).toBeVisible();
    });
  });

  test.describe("F. Agenda", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("switching to Agenda shows chronological items, distinguishing Event from Invoice due", async ({ page }) => {
      const event = await seedEvent({ startsAt: "2026-06-05T09:00:00.000Z", title: "Agenda event" });
      const invoice = await dbQuery<{ id: string; invoiceNumber: string }>("invoice", "create", {
        data: {
          invoiceNumber: `E2E-CAL-AGENDA-${Date.now()}`,
          status: "SENT",
          amount: "250.00",
          subtotal: "250.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          issueDate: "2026-06-01T00:00:00.000Z",
          dueDate: "2026-06-25T00:00:00.000Z",
          clientId: fixtures.clientA.id,
          organizationId: fixtures.orgA.id,
        },
      });
      try {
        await page.goto("/calendar?view=agenda&y=2026&m=6");
        await expect(page.getByText(event.title)).toBeVisible();
        await expect(page.getByText(invoice.invoiceNumber)).toBeVisible();
        await expect(page.getByText("Event", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Invoice due", { exact: true }).first()).toBeVisible();
        // No edit action on an invoice row -- it must be a plain link, not an interactive edit control.
        const invoiceLink = page.getByRole("link", { name: new RegExp(invoice.invoiceNumber) });
        await expect(invoiceLink).toHaveAttribute("href", `/invoices/${invoice.id}/edit`);
      } finally {
        await dbQuery("invoice", "deleteMany", { where: { id: invoice.id } });
      }
    });
  });

  test.describe("G. DST validation", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
      await dbQuery("organizationProfile", "create", {
        data: { organizationId: fixtures.orgA.id, legalName: "Test Org A LLC", country: "US", currency: "USD", timezone: "America/New_York" },
      });
    });

    test.afterEach(async () => {
      await dbQuery("organizationProfile", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    });

    test("a spring-forward nonexistent local time surfaces a truthful validation message, never a silent normalization", async ({ page }) => {
      await page.goto("/calendar?y=2026&m=3");
      await page.getByRole("button", { name: "New event" }).click();
      await page.getByLabel("Title").fill("DST gap test");
      await page.getByLabel("Date").fill("2026-03-08");
      await page.getByLabel("Start time").fill("02:30");
      await page.getByRole("button", { name: "Save event", exact: true }).click();
      await expect(page.getByText(/doesn.t exist/i)).toBeVisible();
      // The dialog stays open -- the event is never silently created.
      await expect(page.getByRole("heading", { name: "New event" })).toBeVisible();
    });
  });

  test.describe("H. Responsive", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    for (const width of [390, 834, 1280]) {
      test(`${width}px: no page-level horizontal overflow on Month, Agenda, and the create dialog`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/calendar?y=2026&m=6");
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

        await page.goto("/calendar?view=agenda&y=2026&m=6");
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

        await page.getByRole("button", { name: "New event" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
        await expect(page.getByLabel("Title")).toBeVisible();
      });
    }
  });
});
