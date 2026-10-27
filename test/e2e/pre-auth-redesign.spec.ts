import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Pre-Auth Redesign, Slice A — responsive/no-overflow coverage across
 * every migrated route, plus the newly-migrated-surface behavior
 * staff-auth-theme.spec.ts doesn't already own (the invite page's own
 * authenticated-vs-unauthenticated top-right truthfulness, and the
 * legal footer actually being reachable/correct on the new dark shell).
 */

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

const ROUTES = ["/", "/login", "/signup", "/forgot-password", "/reset-password", "/organization-unavailable"];

test.describe("Pre-auth redesign — responsive, no horizontal overflow", () => {
  for (const width of [390, 768, 1280, 1920]) {
    test(`${width}px: every migrated route renders with no page-level horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ROUTES) {
        await page.goto(route);
        await assertNoHorizontalOverflow(page);
      }
    });
  }

  test("390px: header brand mark, wordmark, and top-right action all remain visible and reachable, never overlapping", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");

    const brand = page.locator(".auth-shell header a").first();
    await expect(brand).toBeVisible();
    // Scoped to the header — login-form.tsx's own secondary cross-link
    // now deliberately shares the same "Create account" label.
    const topRight = page.locator(".auth-shell header").getByRole("link", { name: "Create account" });
    await expect(topRight).toBeVisible();

    const brandBox = (await brand.boundingBox())!;
    const actionBox = (await topRight.boundingBox())!;
    // No horizontal overlap between the two header regions at the
    // narrowest supported width.
    expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(actionBox.x + 1);
  });

  test("390px: AuthShell's own local Privacy/Terms links remain visible under the dark card (the global Footer hides itself here; this is the one footer that actually renders on this route)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  });

  test("long validation error text wraps instead of forcing overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill("not-an-email");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("x");
    await page.getByRole("button", { name: "Sign in" }).click();
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("Pre-auth redesign — invite page truthful top-right action", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("unauthenticated viewer sees a 'Sign in' top-right action on the invite page", async ({ page }) => {
    await page.goto(`/invite/${fixtures.invitation.token}`);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("an already-authenticated viewer (any state) never sees a false 'Sign in' action", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    // fixtures.owner's own email never matches fixtures.invitation's target
    // email, so this exercises the "signed in as the wrong identity"
    // branch — still, truthfully, no "Sign in" action belongs here.
    await page.goto(`/invite/${fixtures.invitation.token}`);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out and log in with the right account" })).toBeVisible();
  });
});

// (auth)/error.tsx — no safe way to force a real render-time throw from
// E2E without destabilizing a real auth page; its migration onto
// AuthShell (and that it still exposes no error.message/digest) is
// proven instead by the source-contract checks in
// test/unit/staff-auth-theme-tokens.test.ts.

/**
 * Pre-Auth Support Widget V1, Slice C. The trigger's accessible name
 * ("Contact Aqenra Support") is unique in this app, so it's used
 * directly as the locator throughout — no scoping needed the way the
 * "Email"/"Issue type" field labels occasionally require elsewhere on
 * this same page (the widget is the only form with those exact labels
 * open at once; Playwright's own strict-mode would catch a genuine
 * collision immediately if that ever changed).
 *
 * No seeded fixtures needed anywhere in this block — every route
 * exercised here is genuinely unauthenticated, and submission exercises
 * the real Server Action under TEST_MODE's existing fake-send path
 * (see sendEmailViaResend's own TEST_MODE branch) — PLATFORM_SUPPORT_EMAIL
 * is set once for the whole E2E run in playwright.config.ts specifically
 * so this suite can reach the real "ready" success path, not a mocked
 * client-side screen.
 */
test.describe("Pre-auth support widget — visibility and route scoping", () => {
  test("the widget trigger is visible on /login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Contact Aqenra Support" })).toBeVisible();
  });

  test("the widget trigger is visible on /signup", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Contact Aqenra Support" })).toBeVisible();
  });

  for (const route of ["/", "/forgot-password", "/reset-password", "/organization-unavailable"]) {
    test(`the widget trigger is absent on ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("button", { name: "Contact Aqenra Support" })).toHaveCount(0);
    });
  }

  test("exactly one widget and one footer render on /login — no duplicate from the opt-in prop", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Contact Aqenra Support" })).toHaveCount(1);
    await expect(page.locator("footer:visible")).toHaveCount(1);
  });

  test("the main login form remains fully functional alongside the widget", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("textbox", { name: "Email" })).toBeEditable();
    await expect(page.getByRole("textbox", { name: "Password", exact: true })).toBeEditable();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});

test.describe("Pre-auth support widget — open/close lifecycle", () => {
  test("the trigger opens exactly one dialog", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await expect(page.getByRole("heading", { name: "Aqenra Support" })).toBeVisible();
    const openDialogs = await page.evaluate(() => document.querySelectorAll("dialog[open]").length);
    expect(openDialogs).toBe(1);
  });

  test("the visible Close button closes the dialog", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Aqenra Support" })).toBeHidden();
  });

  test("Escape closes the dialog and returns focus to the trigger", async ({ page }) => {
    await page.goto("/login");
    const trigger = page.getByRole("button", { name: "Contact Aqenra Support" });
    await trigger.click();
    await expect(page.getByRole("heading", { name: "Aqenra Support" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Aqenra Support" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("backdrop click closes the dialog", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await expect(page.getByRole("heading", { name: "Aqenra Support" })).toBeVisible();
    // The dialog's own backdrop fills the viewport corner — a point far
    // from the card itself is always backdrop, regardless of card size.
    await page.mouse.click(2, 2);
    await expect(page.getByRole("heading", { name: "Aqenra Support" })).toBeHidden();
  });

  test("focus lands inside the dialog on open", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    const focusInsideDialog = await page.evaluate(() => {
      const dialog = document.querySelector("dialog");
      return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
    });
    expect(focusInsideDialog).toBe(true);
  });

  test("reopening after a successful submission shows a fresh form, never the stale success state", async ({ page }) => {
    await page.goto("/login");
    const trigger = page.getByRole("button", { name: "Contact Aqenra Support" });
    await trigger.click();
    await page.getByLabel("Email address").fill("visitor@example.com");
    await page.getByLabel("Issue type").selectOption("cant-sign-in");
    await page.getByLabel("Message").fill("I have tried logging in several times and keep seeing an error.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/Your message has been sent\. We.ll reply to your email\./)).toBeVisible();

    await page.getByRole("button", { name: "Close" }).last().click();
    await trigger.click();

    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue("");
    await expect(page.getByText("Your message has been sent")).toHaveCount(0);
  });
});

test.describe("Pre-auth support widget — form content and accessibility", () => {
  test("header, description, and safety-note copy match the approved content", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await expect(page.getByRole("heading", { name: "Aqenra Support" })).toBeVisible();
    await expect(
      page.getByText(/Having trouble signing up or signing in\? Send us a message and we.ll reply by email\./),
    ).toBeVisible();
    await expect(
      page.getByText(/Please don.t include passwords, verification codes, or other sensitive information\./),
    ).toBeVisible();
    await expect(page.getByText(/We.ll reply to the email address you provide/)).toBeVisible();
  });

  test("all three fields have real, accessible labels", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Issue type")).toBeVisible();
    await expect(page.getByLabel("Message")).toBeVisible();
  });

  test("the issue-type select offers exactly the three approved options, mapped to Slice B's own values", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    const select = page.getByLabel("Issue type");
    const values = await select.locator("option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    expect(values.filter(Boolean)).toEqual(["cant-sign-up", "cant-sign-in", "other"]);
    await expect(select.locator("option", { hasText: "Can't sign up" })).toHaveCount(1);
    await expect(select.locator("option", { hasText: "Can't sign in" })).toHaveCount(1);
    await expect(select.locator("option", { hasText: "Other issue" })).toHaveCount(1);
  });

  test("the message field states the 20-4000 character guidance", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await expect(page.getByText(/20.{1,2}4000 characters/)).toBeVisible();
  });

  test("the message field's description is wired via aria-describedby", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    const textarea = page.getByLabel("Message");
    const describedBy = await textarea.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const description = page.locator(`#${describedBy}`);
    await expect(description).toContainText("20");
  });

  test("the honeypot field exists, matches Slice B's exact FormData name, and is removed from tab order", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    const honeypot = page.locator('input[name="honeypot"]');
    await expect(honeypot).toHaveCount(1);
    await expect(honeypot).toHaveAttribute("tabindex", "-1");
    // Visually hidden (off-screen), not display:none/visibility:hidden —
    // see the component's own doc comment on why that distinction matters
    // for honeypot effectiveness.
    const box = await honeypot.boundingBox();
    expect(box === null || box.x < 0).toBe(true);
  });

  test("the FormData field names visible to the server exactly match Slice B's allowlist — no extra fields", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    const names = await page
      .locator("form")
      .filter({ has: page.getByLabel("Email address") })
      .locator("input[name], select[name], textarea[name]")
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).name));
    expect(new Set(names)).toEqual(new Set(["email", "issueType", "message", "honeypot"]));
  });

  test("a link to /privacy is present near the form's help copy", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await expect(page.locator("dialog").getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });

  test("Enter inside the widget's email field submits the widget, never the surrounding login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await page.getByLabel("Email address").fill("visitor@example.com");
    await page.getByLabel("Issue type").selectOption("other");
    await page.getByLabel("Message").fill("This message is long enough to pass validation for this test.");
    await page.getByLabel("Email address").press("Enter");
    // If this had instead submitted the login form, the browser would
    // navigate/reload; the dialog (and the login page itself) would be
    // gone. Still on /login, and the widget's own success state appears.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Your message has been sent")).toBeVisible();
  });
});

test.describe("Pre-auth support widget — submission lifecycle", () => {
  test("a fully valid submission succeeds through the real Server Action and shows the approved success copy", async ({
    page,
  }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await page.getByLabel("Email address").fill("visitor@example.com");
    await page.getByLabel("Issue type").selectOption("cant-sign-up");
    await page.getByLabel("Message").fill("I filled out the signup form but never received a confirmation email.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/Your message has been sent\. We.ll reply to your email\./)).toBeVisible();
  });

  test("a server-side validation failure renders the field error and preserves every entered value", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await page.getByLabel("Email address").fill("visitor@example.com");
    await page.getByLabel("Issue type").selectOption("other");
    await page.getByLabel("Message").fill("too short");
    // Bypasses the client-side minlength/required constraints that would
    // otherwise block this exact submission in a normal browser — this
    // is a deliberate test of defense-in-depth (Slice B's own
    // server-side validation, independent of what the client enforced),
    // the same "preserve the entered form data and allow retry"
    // requirement this suite exists to prove even when client-side
    // validation is bypassed or unavailable.
    await page.evaluate(() => {
      document.querySelectorAll("[required],[minlength]").forEach((el) => {
        el.removeAttribute("required");
        el.removeAttribute("minlength");
      });
    });
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "at least 20 characters" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue("visitor@example.com");
    await expect(page.getByLabel("Message")).toHaveValue("too short");
  });

  test("submitting twice in a row (retry after a failure) succeeds the second time without losing the dialog", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await page.getByLabel("Email address").fill("visitor@example.com");
    await page.getByLabel("Issue type").selectOption("other");
    await page.getByLabel("Message").fill("too short");
    await page.evaluate(() => {
      document.querySelectorAll("[required],[minlength]").forEach((el) => {
        el.removeAttribute("required");
        el.removeAttribute("minlength");
      });
    });
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    // Retry with the corrected message, same still-open dialog.
    await page.getByLabel("Message").fill("I have tried logging in several times and keep seeing an error.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Your message has been sent")).toBeVisible();
  });
});

test.describe("Pre-auth support widget — responsive", () => {
  for (const vp of [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 390, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    test(`${vp.width}x${vp.height}: no page-level horizontal overflow on /login or /signup, trigger stays visible and clear of the footer`, async ({
      page,
    }) => {
      await page.setViewportSize(vp);
      for (const route of ["/login", "/signup"]) {
        await page.goto(route);
        await assertNoHorizontalOverflow(page);

        const trigger = page.getByRole("button", { name: "Contact Aqenra Support" });
        await expect(trigger).toBeVisible();

        const triggerBox = (await trigger.boundingBox())!;
        const footerBox = await page.locator("footer.auth-shell-footer").boundingBox();
        const intersects =
          footerBox !== null &&
          !(
            triggerBox.x + triggerBox.width < footerBox.x ||
            footerBox.x + footerBox.width < triggerBox.x ||
            triggerBox.y + triggerBox.height < footerBox.y ||
            footerBox.y + footerBox.height < triggerBox.y
          );
        expect(intersects).toBe(false);

        // Entirely within the viewport — never clipped off an edge.
        expect(triggerBox.x).toBeGreaterThanOrEqual(0);
        expect(triggerBox.y).toBeGreaterThanOrEqual(0);
        expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(vp.width);
        expect(triggerBox.y + triggerBox.height).toBeLessThanOrEqual(vp.height);
      }
    });
  }

  test("320px: the dialog's own content remains reachable, fields and the submit button are all visible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Contact Aqenra Support" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Issue type")).toBeVisible();
    await expect(page.getByLabel("Message")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});
