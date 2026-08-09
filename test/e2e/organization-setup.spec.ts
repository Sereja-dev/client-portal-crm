import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Customer Setup Wizard (Stage 6.2). Same session-injection pattern as
 * test/e2e/analytics-ui.spec.ts's own actAsMember (real Supabase Auth is
 * unavailable locally — see test/support/e2e-session.ts).
 */

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

async function actAsMember(
  context: BrowserContext,
  baseURL: string,
  user: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
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

test.describe("Company Profile", () => {
  test("OWNER can view and save the company profile form", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");
    // Sale-Ready Phase A.1 (Business Identity), PR3 — same page/route,
    // new heading: "Configure your business," not just legal/locale
    // details.
    await expect(page.getByRole("heading", { name: "Business identity", level: 1 })).toBeVisible();

    await page.getByLabel("Legal company name").fill("E2E Test Org LLC");
    await page.getByLabel("Country").fill("United States");
    await page.getByLabel("Currency").selectOption("USD");
    await page.getByLabel("Time zone").selectOption("America/New_York");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/settings/company") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save company profile" }).click(),
    ]);
    await expect(page.getByText("Company profile saved.")).toBeVisible();
    // Stage 6.2.1: the exact symptom being regression-tested — a
    // successful save must never bounce the browser to /login.
    await expect(page).not.toHaveURL(/\/login/);

    // Reload — the exact check a follow-up page render performs. Proves
    // both real persistence (not a client-side-only success message) and
    // that the session survived the mutation: a redirect-to-login would
    // fail this navigation outright.
    await page.reload();
    await expect(page).toHaveURL(/\/settings\/company/);
    await expect(page.getByLabel("Legal company name")).toHaveValue("E2E Test Org LLC");
  });

  test("MEMBER sees a read-only summary, no editable form", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/settings/company");
    await expect(page.getByText("Only the organization owner can update company details.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save company profile" })).toHaveCount(0);
  });

  test.describe("Business Identity fields (Sale-Ready Phase A.1, PR3)", () => {
    test("OWNER sees every field grouped into Business/Contact/Address/Tax/Branding sections, can save all of them, and they persist across reload", async ({
      page,
      context,
      baseURL,
    }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/settings/company");

      // Grouped as real <fieldset>/<legend> sections — each legend is
      // its own accessible group label, not just visual text.
      for (const section of ["Business", "Contact", "Address", "Tax", "Branding"]) {
        await expect(page.getByRole("group", { name: section })).toBeVisible();
      }

      await page.getByLabel("Legal company name").fill("E2E Identity Org LLC");
      await page.getByLabel("Country").fill("United States");
      await page.getByLabel("Currency").selectOption("USD");
      await page.getByLabel("Time zone").selectOption("America/New_York");
      await page.getByLabel("Support email").fill("support@e2e-identity.example.com");
      await page.getByLabel("Website").fill("https://e2e-identity.example.com");
      await page.getByLabel("Phone").fill("+1 555-0100");
      await page.getByLabel("Street address").fill("123 Main St");
      await page.getByLabel("City").fill("Springfield");
      await page.getByLabel("State / Province").fill("IL");
      await page.getByLabel("Postal code").fill("62704");
      await page.getByLabel("Tax ID / VAT").fill("EU123456789");
      await page.getByLabel("Brand color").fill("#0F172A");

      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/settings/company") && r.request().method() === "POST"),
        page.getByRole("button", { name: "Save company profile" }).click(),
      ]);
      await expect(page.getByText("Company profile saved.")).toBeVisible();

      await page.reload();
      await expect(page.getByLabel("Support email")).toHaveValue("support@e2e-identity.example.com");
      await expect(page.getByLabel("Website")).toHaveValue("https://e2e-identity.example.com");
      await expect(page.getByLabel("Phone")).toHaveValue("+1 555-0100");
      await expect(page.getByLabel("Street address")).toHaveValue("123 Main St");
      await expect(page.getByLabel("City")).toHaveValue("Springfield");
      await expect(page.getByLabel("State / Province")).toHaveValue("IL");
      await expect(page.getByLabel("Postal code")).toHaveValue("62704");
      await expect(page.getByLabel("Tax ID / VAT")).toHaveValue("EU123456789");
      await expect(page.getByLabel("Brand color")).toHaveValue("#0F172A");
    });

    test("an invalid optional field (malformed website) shows its own field error and saves nothing", async ({
      page,
      context,
      baseURL,
    }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/settings/company");

      await page.getByLabel("Legal company name").fill("E2E Invalid Field Org LLC");
      await page.getByLabel("Country").fill("United States");
      await page.getByLabel("Currency").selectOption("USD");
      await page.getByLabel("Time zone").selectOption("America/New_York");
      await page.getByLabel("Website").fill("http://not-https.example.com");

      await page.getByRole("button", { name: "Save company profile" }).click();
      await expect(page.getByText("Enter a valid https:// URL.")).toBeVisible();
      await expect(page.getByText("Company profile saved.")).toHaveCount(0);
    });

    test("MEMBER's read-only summary shows every Business Identity field, not just the original five", async ({
      page,
      context,
      baseURL,
    }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/settings/company");
      await page.getByLabel("Legal company name").fill("E2E Member View Org LLC");
      await page.getByLabel("Country").fill("United States");
      await page.getByLabel("Currency").selectOption("USD");
      await page.getByLabel("Time zone").selectOption("America/New_York");
      await page.getByLabel("Support email").fill("support@e2e-member-view.example.com");
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/settings/company") && r.request().method() === "POST"),
        page.getByRole("button", { name: "Save company profile" }).click(),
      ]);

      await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
      await page.goto("/settings/company");
      await expect(page.getByText("support@e2e-member-view.example.com")).toBeVisible();
      // A field never set for this organization still renders, as "Not set" — read permissions cover every field, not just the ones happened to be filled in.
      await expect(page.getByText("Tax ID / VAT")).toBeVisible();
    });
  });
});

test.describe("Payment Details", () => {
  test("OWNER can view and save payment details", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/payment");
    await expect(page.getByRole("heading", { name: "Payment receiving details", level: 1 })).toBeVisible();

    await page.getByLabel("Bank name").fill("First Bank");
    await page.getByLabel("Account holder").fill("Test Org A");
    await page.getByLabel("Account number / IBAN").fill("GB29NWBK60161331926819");
    await page.getByLabel("SWIFT / BIC").fill("NWBKGB2L");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/settings/payment") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save payment details" }).click(),
    ]);
    await expect(page.getByText("Payment details saved.")).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);

    await page.reload();
    await expect(page).toHaveURL(/\/settings\/payment/);
    await expect(page.getByLabel("Bank name")).toHaveValue("First Bank");
  });

  test("MEMBER sees Access denied, never the form or any data", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/settings/payment");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(page.getByLabel("Bank name")).toHaveCount(0);
  });

  test("ADMIN sees Access denied too — stricter than the OWNER/ADMIN split used elsewhere", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.admin, fixtures.orgA.id);
    await page.goto("/settings/payment");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  });
});

test.describe("Domain Settings", () => {
  test("OWNER sees the generated subdomain and can save a custom domain", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/domain");
    await expect(page.getByRole("heading", { name: "Domain settings", level: 1 })).toBeVisible();
    await expect(page.getByText(`${fixtures.orgA.slug}.`)).toBeVisible();

    const customDomain = `${fixtures.runId}-custom.example.com`;
    await page.getByLabel("Custom domain").fill(customDomain);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/settings/domain") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save domain settings" }).click(),
    ]);
    await expect(page.getByText("Domain settings saved.")).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);

    await page.reload();
    await expect(page).toHaveURL(/\/settings\/domain/);
    await expect(page.getByLabel("Custom domain")).toHaveValue(customDomain);
  });

  test("MEMBER can view the generated subdomain but cannot edit", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/settings/domain");
    await expect(page.getByText(`${fixtures.orgA.slug}.`)).toBeVisible();
    await expect(page.getByText("Only the organization owner can update domain settings.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save domain settings" })).toHaveCount(0);
  });
});

test.describe("Client Portal identity", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
  });

  test("cannot reach Company Profile, Payment Details, or Domain Settings — every route redirects to /portal", async ({ page }) => {
    for (const path of ["/settings/company", "/settings/payment", "/settings/domain"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/portal$/);
    }
  });
});

test.describe("Onboarding checklist integration", () => {
  test("the Setup Wizard steps appear in the existing dashboard checklist, right after Welcome", async ({ page, context, baseURL }) => {
    // A dedicated, fresh organization — not fixtures.orgA, which other
    // tests in this same file progressively complete Company/Payment/
    // Domain setup for (their own OWNER flows above) and whose checklist
    // could otherwise already be fully complete/hidden by the time this
    // test runs, an ordering coupling this test must not depend on.
    const org = await dbQuery<{ id: string }>("organization", "create", {
      data: { name: `E2E Setup Wizard Checklist ${fixtures.runId}`, slug: `e2e-setup-wizard-checklist-${fixtures.runId}` },
    });
    await dbQuery("membership", "create", { data: { userId: fixtures.owner.id, organizationId: org.id, role: "OWNER" } });

    try {
      await actAsMember(context, baseURL!, fixtures.owner, org.id);
      await page.goto("/dashboard");
      // Scoped to the checklist's own row (not a bare page-wide text
      // search): Stage 7.1.1's "Up next" completion summary also quotes
      // these same step labels in its own text, so an unscoped
      // page.getByText(label) now matches both and violates strict mode.
      for (const label of ["Set up your company profile", "Add payment receiving details", "Review your domain settings"]) {
        await expect(page.getByRole("listitem").filter({ hasText: label })).toBeVisible();
      }
    } finally {
      await dbQuery("membership", "deleteMany", { where: { organizationId: org.id } });
      await dbQuery("organization", "delete", { where: { id: org.id } });
    }
  });
});
