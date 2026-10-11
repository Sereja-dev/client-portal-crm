import { test, expect, type BrowserContext, type Locator } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectCurrencyOption } from "../support/select-currency-option";

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

/**
 * Stability Correction F3 — genuine root cause for the SVG-rejection
 * test's flake (empirically confirmed, not a slow-render timing issue):
 * the shared FileInput component's `onChange` (src/components/ui/
 * file-input.tsx's own `handleChange`, which both sets its own visible
 * filename text AND calls the parent's `handleFileChange`) is only
 * wired to the native <input type="file"> once React finishes
 * hydrating that DOM node. `setInputFiles(...)` performs a real,
 * browser-level file selection immediately on page load — if that
 * lands a moment before hydration attaches the listener, the native
 * `change` event fires into a node with no handler at all, so
 * `previewUrl` never updates. A longer assertion timeout cannot recover
 * from this: it was proven, via a captured failure log, to retry the
 * *same* unchanged, already-resolved locator 34 times over a full 15s
 * window without the value ever starting to trend toward the expected
 * one — the state change was never triggered, not merely running late.
 * Re-issuing the identical `setInputFiles` call is a real repeat of the
 * same user action (the browser doesn't retain any "already chosen"
 * state that setInputFiles itself moves past), not a fabricated retry
 * of the assertion, and is only attempted once, only after the first,
 * normal, short real wait has already failed.
 */
async function setInputFilesPastHydration(
  fileInput: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
  confirmSelected: () => Promise<void>,
): Promise<void> {
  await fileInput.setInputFiles(file);
  try {
    await confirmSelected();
  } catch {
    await fileInput.setInputFiles(file);
    await confirmSelected();
  }
}

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
    await selectCurrencyOption(page, "Currency", "USD");
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
      await selectCurrencyOption(page, "Currency", "USD");
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
      await selectCurrencyOption(page, "Currency", "USD");
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
      await selectCurrencyOption(page, "Currency", "USD");
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

    /**
     * Design/polish — the shared DefinitionList/DefinitionItem primitive
     * (src/components/ui/definition-list.tsx) adopted here. Same
     * established unbroken-token convention as
     * organization-suspension-actions.spec.ts's own LONG_UNBROKEN_NAME —
     * one token, no spaces at all, so wrapping can only come from
     * `wrap-anywhere` (overflow-wrap: anywhere), never a natural word
     * break.
     */
    test("MEMBER's read-only summary safely wraps a long unbroken legal name, no horizontal overflow", async ({
      page,
      context,
      baseURL,
    }) => {
      const LONG_LEGAL_NAME = `${"X".repeat(120)}Corp`;
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/settings/company");
      await page.getByLabel("Legal company name").fill(LONG_LEGAL_NAME);
      await page.getByLabel("Country").fill("United States");
      await selectCurrencyOption(page, "Currency", "USD");
      await page.getByLabel("Time zone").selectOption("America/New_York");
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/settings/company") && r.request().method() === "POST"),
        page.getByRole("button", { name: "Save company profile" }).click(),
      ]);

      await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);

      // Representative widths, matching this repo's own established sweep
      // (see responsive-layout.spec.ts) — narrow mobile through wide
      // desktop, since the shell itself is now capped at max-w-7xl (PR
      // #135) rather than unbounded.
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/settings/company");
        await expect(page.getByText(LONG_LEGAL_NAME)).toBeVisible();

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          scrollWidth,
          `at ${width}px: scrollWidth (${scrollWidth}) should not exceed clientWidth (${clientWidth})`,
        ).toBeLessThanOrEqual(clientWidth);
      }
    });
  });

  test.describe("Logo upload (Sale-Ready Phase A.1, PR5)", () => {
    // A real, minimal 1x1 PNG — real Storage isn't reachable in this
    // sandbox (see attachments.spec.ts's own doc comment for why), so
    // uploadLogoObject's TEST_MODE branch serves this back through
    // src/app/api/e2e-test-storage/[...path]/route.ts, the same real code
    // path production uses (see src/lib/storage/logo-storage.ts).
    const LOGO_PNG_BYTES = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    /**
     * Product UI/UX PR 1 — the shared FileInput component's app-authored
     * presentation on the Company Logo surface, proven against a real
     * Chromium instance. Distinct from the pre-existing "No logo" preview-
     * placeholder text (the small thumbnail box) — "No file chosen" is the
     * new FileInput's own empty-state label, a separate element.
     */
    test("the logo file picker shows app-authored trigger/empty-state text and updates on selection, never native browser chrome", async ({
      page,
      context,
      baseURL,
    }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/settings/company");

      const fileInput = page.getByLabel("Choose logo");
      await expect(fileInput).toBeAttached();
      await expect(page.getByText("No file chosen")).toBeVisible();

      await fileInput.setInputFiles({
        name: "e2e-logo.png",
        mimeType: "image/png",
        buffer: LOGO_PNG_BYTES,
      });
      await expect(page.getByText("e2e-logo.png", { exact: true })).toBeVisible();
      await expect(page.getByText("No file chosen")).toHaveCount(0);

      await fileInput.focus();
      await expect(fileInput).toBeFocused();
    });

    test("OWNER sees a live preview immediately, then the real persisted logo after upload and reload", async ({
      page,
      context,
      baseURL,
    }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/settings/company");

      // The Business Identity text form must already have a saved profile
      // for logo upload to succeed at all (see uploadOrganizationLogo's own
      // doc comment) — guaranteed here by the earlier tests in this same
      // file/describe block, which this suite already runs single-worker,
      // in-order (see playwright.config.ts's fullyParallel: false).
      await expect(page.getByText("No logo")).toBeVisible();
      await expect(page.getByRole("button", { name: "Upload logo" })).toBeVisible();

      await page.getByLabel("Choose logo").setInputFiles({
        name: "e2e-logo.png",
        mimeType: "image/png",
        buffer: LOGO_PNG_BYTES,
      });
      // The live preview (a client-only blob: URL) appears immediately,
      // before the upload has even been submitted.
      const logoImg = page.getByAltText("Organization logo");
      await expect(logoImg).toBeVisible();
      await expect(logoImg).toHaveAttribute("src", /^blob:/);

      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/settings/company") && r.request().method() === "POST"),
        page.getByRole("button", { name: "Upload logo" }).click(),
      ]);

      await page.reload();
      const persistedLogoImg = page.getByAltText("Organization logo");
      await expect(persistedLogoImg).toBeVisible();
      // No longer a blob: URL — the real Storage public URL survived a
      // full reload, proving it was actually persisted, not just a
      // client-side optimistic preview.
      await expect(persistedLogoImg).toHaveAttribute("src", /\/api\/e2e-test-storage\/logos\//);
      await expect(page.getByRole("button", { name: "Replace logo" })).toBeVisible();
    });

    test("an SVG is rejected with the backend's own validation error, and the persisted logo is unchanged", async ({
      page,
      context,
      baseURL,
    }) => {
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      // Runs after the upload test above (same file, same single-worker,
      // in-order execution) — a logo already exists for this org. Read
      // via dbQuery (the real, persisted value), not the rendered <img>'s
      // src — picking the SVG legitimately shows its own optimistic blob:
      // preview client-side before the server ever rejects it (the same
      // "live preview" behavior the test above already covers), so the
      // rendered src is expected to change; what must NOT change is the
      // actual persisted OrganizationProfile.logoUrl.
      const profileBefore = await dbQuery<{ logoUrl: string | null }>("organizationProfile", "findUniqueOrThrow", {
        where: { organizationId: fixtures.orgA.id },
      });

      await page.goto("/settings/company");
      // The optimistic client-side preview shows even for a file that will
      // fail server-side validation — it's a pure "what did you pick"
      // preview, uninvolved with the server's own accept/reject decision.
      // Stability Correction F3 (genuinely reproduced locally during this
      // correction's own bounded stress sample — 1 failure in 8 full-file
      // runs, this exact test): a captured failure log proved this is not
      // a slow render — the same stale, already-persisted logo URL was
      // re-read 34 times over a full 15s window without ever starting to
      // change. This is a fresh page.goto load, so `setInputFiles` can
      // land a moment before React finishes hydrating the shared
      // FileInput's onChange handler onto this exact DOM node (see
      // setInputFilesPastHydration's own doc comment above); when that
      // happens the native change event is simply never seen by React.
      // The asserted content (a live blob: preview) is unchanged.
      await setInputFilesPastHydration(
        page.getByLabel("Choose logo"),
        { name: "icon.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>") },
        () => expect(page.getByAltText("Organization logo")).toHaveAttribute("src", /^blob:/),
      );

      await page.getByRole("button", { name: "Replace logo" }).click();
      await expect(page.getByText("Only PNG, JPEG, and WebP images are supported.")).toBeVisible();

      const profileAfter = await dbQuery<{ logoUrl: string | null }>("organizationProfile", "findUniqueOrThrow", {
        where: { organizationId: fixtures.orgA.id },
      });
      expect(profileAfter.logoUrl).toBe(profileBefore.logoUrl);
    });

    test("MEMBER sees the current logo but no upload control", async ({ page, context, baseURL }) => {
      await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
      await page.goto("/settings/company");

      // Stability Correction F3 — see the SVG-rejection test above's own
      // comment for the identical reasoning: a fresh page load's own
      // async render, not a same-test-sequence dependency issue (the
      // persisted logo itself is already correctly saved by this point).
      await expect(page.getByAltText("Organization logo")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Upload logo|Replace logo/ })).toHaveCount(0);
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

/**
 * Pre-Launch Audit F1 fix — src/components/settings/settings-nav.tsx,
 * rendered once by src/app/(dashboard)/settings/layout.tsx across every
 * /settings/* page. Before this fix, /settings/company, /settings/payment,
 * and /settings/domain had no persistent UI path back to them once
 * onboarding was dismissed/completed (see the invoice-issuance-readiness
 * notice's own "renders nothing once both are configured" behavior,
 * test/e2e/invoice-issuance-readiness.spec.ts) — reachable only by typing
 * the URL directly. These tests prove real click-through reachability and
 * that link visibility matches the exact same canonical authorization
 * helpers (organization-setup/authorization.ts) each destination page
 * already independently enforces — never a second, separately-invented
 * permission check.
 */
test.describe("Settings navigation (Pre-Launch Audit F1)", () => {
  test("OWNER can reach Company, Payment details, and Domain through real Settings nav clicks — never a typed URL", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    // Start from the one page the primary Sidebar's own "Settings" link
    // already reaches — the exact starting point a real user has today.
    await page.goto("/settings/notifications");

    const settingsNav = page.getByRole("navigation", { name: "Settings" });
    await expect(settingsNav).toBeVisible();

    await settingsNav.getByRole("link", { name: "Company" }).click();
    await expect(page).toHaveURL(/\/settings\/company$/);
    await expect(page.getByRole("heading", { name: "Business identity", level: 1 })).toBeVisible();

    await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Payment details" }).click();
    await expect(page).toHaveURL(/\/settings\/payment$/);
    await expect(page.getByRole("heading", { name: "Payment receiving details", level: 1 })).toBeVisible();

    await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Domain" }).click();
    await expect(page).toHaveURL(/\/settings\/domain$/);
    await expect(page.getByRole("heading", { name: "Domain settings", level: 1 })).toBeVisible();
  });

  test("the current Settings destination is marked aria-current, and only that link", async ({ page, context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/domain");

    const settingsNav = page.getByRole("navigation", { name: "Settings" });
    await expect(settingsNav.getByRole("link", { name: "Domain" })).toHaveAttribute("aria-current", "page");
    await expect(settingsNav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(settingsNav.getByRole("link", { name: "Company" })).not.toHaveAttribute("aria-current", "page");
  });

  test("OWNER sees the Payment details nav entry; MEMBER and ADMIN never see it, matching canAccessPaymentDetails", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Payment details" })).toBeVisible();

    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/settings/company");
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Payment details" })).toHaveCount(0);

    await actAsMember(context, baseURL!, fixtures.admin, fixtures.orgA.id);
    await page.goto("/settings/company");
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Payment details" })).toHaveCount(0);
  });

  test("Company, Domain, Notifications, and Billing nav entries stay visible to MEMBER — matching their existing 'any member may view' pages", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/settings/company");

    const settingsNav = page.getByRole("navigation", { name: "Settings" });
    for (const label of ["Company", "Domain", "Notifications", "Billing"]) {
      await expect(settingsNav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("a MEMBER who navigates straight to /settings/payment by URL still gets Access denied — the nav link is discoverability only, never the security boundary", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/settings/payment");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(page.getByLabel("Bank name")).toHaveCount(0);
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
