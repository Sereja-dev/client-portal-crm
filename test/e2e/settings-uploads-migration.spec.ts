import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Design System page migration Batch 7 — Shared uploads (AttachmentsSection/
 * AttachmentUploadForm) + simple Settings (Company/Domain/Payment/
 * Notifications). Covers this batch's own critical gates: real Dark
 * computed-style checks for the migrated card surfaces and text (proving
 * tokens actually resolve, not just that a class string was swapped), and
 * mobile no-overflow for the largest surface (Company, multi-fieldset) and
 * for an Attachments row. Every interaction path (upload/download/delete,
 * toggle persistence, form save) is already exhaustively covered by
 * test/e2e/attachments.spec.ts and test/e2e/organization-setup.spec.ts —
 * deliberately not repeated here.
 */

let fixtures: TestFixtures;

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: fixtures.orgA.id,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Design System Batch 7 — Shared uploads + simple Settings", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async () => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
  });

  test("Dark: AttachmentsSection card is opaque, row title/Download link readable, no raw-white island", async ({
    page,
    context,
    baseURL,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await actAsOwner(context, baseURL!);
    await page.goto(`/clients/${fixtures.clientA.id}/edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    // fixtures.attachment is pre-seeded on clientA with originalName
    // "report.pdf" (see test/fixtures/seed.ts) — not exposed on the
    // TestFixtures type itself, so asserted here as the known literal.
    // .first() because accumulated cross-run fixture state can leave more
    // than one identically-named row; any instance has identical styling.
    const title = page.getByText("report.pdf", { exact: true }).first();
    await expect(title).toBeVisible();

    const list = page.locator("ul", { has: title });
    // expect.poll (not a one-shot evaluate): `transition-colors` on these
    // elements can still be animating from the pre-correction Light paint
    // to the just-applied Dark tokens for a moment after data-theme flips
    // — polling waits out that transition instead of racing it.
    await expect
      .poll(() => list.evaluate((el) => getComputedStyle(el).backgroundColor))
      // Dark's --surface is rgb(27, 31, 38) — never transparent, never white.
      .toBe("rgb(27, 31, 38)");

    await expect.poll(() => title.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    const downloadLink = page.getByRole("link", { name: "Download" }).first();
    await expect(downloadLink).toBeVisible();
    // text-text-secondary in Dark — never invisible-on-dark gray-700.
    await expect
      .poll(() => downloadLink.evaluate((el) => getComputedStyle(el).color))
      .toBe("rgb(160, 166, 176)");

    expect(errors).toEqual([]);
  });

  test("Shared-consumer regression: AttachmentsSection also renders correctly on Project and Invoice edit (Dark, no console errors)", async ({
    page,
    context,
    baseURL,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await actAsOwner(context, baseURL!);

    await page.goto(`/projects/${fixtures.project.id}/edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    const projectHeading = page.getByRole("heading", { name: "Attachments" });
    await expect(projectHeading).toBeVisible();
    await expect.poll(() => projectHeading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    await page.goto(`/invoices/${fixtures.invoice.id}/edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    const invoiceHeading = page.getByRole("heading", { name: "Attachments" });
    await expect(invoiceHeading).toBeVisible();
    await expect.poll(() => invoiceHeading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    expect(errors).toEqual([]);
  });

  test("Dark: Company settings form surface and fieldset legends are readable", async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await actAsOwner(context, baseURL!);
    await page.goto("/settings/company");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    const form = page.locator("form").filter({ hasText: "Business" });
    await expect.poll(() => form.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(27, 31, 38)");

    const legend = page.getByText("Business", { exact: true });
    await expect.poll(() => legend.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    // The logo card is a sibling, separately-migrated surface.
    const logoHeading = page.getByRole("heading", { name: "Logo" });
    await expect(logoHeading).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("Dark: Domain and Payment settings cards are opaque, no console errors", async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await actAsOwner(context, baseURL!);

    await page.goto("/settings/domain");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    const domainForm = page.locator("form").filter({ hasText: "Custom domain" });
    await expect(domainForm).toBeVisible();
    await expect
      .poll(() => domainForm.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(27, 31, 38)");

    await page.goto("/settings/payment");
    const paymentForm = page.locator("form").filter({ hasText: "Bank name" });
    await expect(paymentForm).toBeVisible();
    await expect
      .poll(() => paymentForm.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(27, 31, 38)");

    expect(errors).toEqual([]);
  });

  test("Dark: Notifications settings table is opaque, checkbox accent is not raw black, no console errors", async ({
    page,
    context,
    baseURL,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await actAsOwner(context, baseURL!);
    await page.goto("/settings/notifications");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    const table = page.locator("table");
    await expect(table).toBeVisible();
    const wrapper = page.locator("table").locator("..");
    await expect.poll(() => wrapper.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(27, 31, 38)");

    const checkbox = page.locator('input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible();
    // Dark's --accent is rgb(108, 101, 201) — never the old literal black.
    await expect
      .poll(() => checkbox.evaluate((el) => getComputedStyle(el).accentColor))
      .toBe("rgb(108, 101, 201)");

    expect(errors).toEqual([]);
  });

  test("Mobile (390/320px): Company settings fits viewport with no horizontal overflow", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsOwner(context, baseURL!);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/settings/company");
      await expect(page.getByRole("heading", { name: "Business identity" })).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });

  test("Mobile (390/320px): Attachments row on Client edit fits viewport with no horizontal overflow", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsOwner(context, baseURL!);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/clients/${fixtures.clientA.id}/edit`);
      await expect(page.getByText("report.pdf", { exact: true }).first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
});
