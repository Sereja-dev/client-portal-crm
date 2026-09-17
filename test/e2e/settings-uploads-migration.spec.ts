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

    // Client Edit Transient SSR/Hydration Duplication (read-only
    // diagnostic) -- for a short window (~60-350ms) after this page
    // navigates, React briefly double-mounts this page's Client-Component-
    // adjacent sections (Contacts/Attachments/Portal Access/Timeline) as
    // two content-identical subtrees before settling to one. Proven NOT a
    // server-HTML duplication (byte-position-verified: exactly one real
    // <ul> per section in the raw SSR response), NOT a duplicate DB row
    // (exactly one Attachment row exists throughout), and NOT a dead/
    // inert control (a direct in-page interactivity probe found the
    // transient copy's own Delete button fully functional) -- a genuine
    // but NON-BLOCKING hydration-timing artifact, not something to wait
    // out with an arbitrary sleep or to treat as evidence of a real
    // defect. A bare page-wide `ul`/text lookup strict-mode-fails
    // whenever this window is hit (both copies genuinely match), and
    // would separately also be ambiguous against the unrelated Timeline/
    // Activity list's own <ul> even outside that window. Every locator
    // below is instead scoped to the closest real container of the
    // "Attachments" heading, then deterministically disambiguated with
    // `.first()`/`.last()` -- never masking a real defect, since any two
    // matches here are, per that diagnostic, content-identical.
    const attachmentsHeading = page.getByRole("heading", { name: "Attachments", level: 2 });
    await expect(attachmentsHeading.first()).toBeVisible();

    // Two DOM levels up from the heading is AttachmentsSection's own
    // wrapper <div> -- h2 -> the heading/count flex row -> the section
    // wrapper that also holds the upload form and the list as siblings
    // of that row (see src/components/attachments/attachments-section.tsx's
    // own structure) -- never the much bigger shared card ClientForm/
    // Contacts/Attachments/Portal Access all sit inside together on this
    // page. `.first()` sits at the very end, not on `attachmentsHeading`
    // itself, so a genuine two-heading window (see this test's own
    // comment above) still resolves to one complete, real wrapper rather
    // than mixing an ancestor from one copy with a descendant from the
    // other.
    const attachmentsSection = attachmentsHeading.locator("xpath=../..").first();

    // fixtures.attachment is pre-seeded on clientA with originalName
    // "report.pdf" (see test/fixtures/seed.ts) — not exposed on the
    // TestFixtures type itself, so asserted here as the known literal.
    const title = attachmentsSection.getByText("report.pdf", { exact: true }).first();
    await expect(title).toBeVisible();

    const list = attachmentsSection.getByRole("list").first();
    // expect.poll (not a one-shot evaluate): `transition-colors` on these
    // elements can still be animating from the pre-correction Light paint
    // to the just-applied Dark tokens for a moment after data-theme flips
    // — polling waits out that transition instead of racing it.
    await expect
      .poll(() => list.evaluate((el) => getComputedStyle(el).backgroundColor))
      // Dark's --surface is rgb(27, 31, 38) — never transparent, never white.
      .toBe("rgb(27, 31, 38)");

    await expect.poll(() => title.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    const downloadLink = attachmentsSection.getByRole("link", { name: "Download" }).first();
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
