import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { testEmail, testSlug } from "../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../support/env";

/**
 * Onboarding Redesign — real-browser coverage for the new short Dashboard
 * onboarding card (src/components/onboarding/onboarding-card.tsx).
 * Replaces the previous full 12-row-checklist E2E suite: the legacy
 * 11-step engine (buildOnboardingProgress/steps.ts) is completely
 * untouched and still backs Platform Admin's own organization detail
 * view (test/e2e/platform-admin-organization-onboarding.spec.ts, not
 * modified by this redesign) — this file covers only the new 5-step
 * card. Backend correctness (progress computation, dependency ordering,
 * skip semantics, role-aware CTA gating, sample-data interaction) is
 * already exhaustively covered in test/unit/onboarding-visible-
 * progress.test.ts and test/integration/onboarding/visible-progress.test.ts
 * — this file only covers what genuinely needs a real browser.
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

async function gotoAndSettle(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

type FreshOrg = { org: { id: string }; owner: { id: string; email: string } };

/** A brand-new organization with zero business data — real Client/Project/etc. rows would make a step COMPLETE by construction, which the "empty progress"/skip/dismiss tests below need to rule out. */
async function createFreshOrg(runId: string, label: string): Promise<FreshOrg> {
  const org = await dbQuery<{ id: string }>("organization", "create", {
    data: { name: `Fresh ${label}`, slug: testSlug(`onboarding-${label}`, runId) },
  });
  const owner = await dbQuery<{ id: string; email: string }>("user", "create", {
    data: { id: randomUUID(), email: testEmail(`onboarding-${label}-owner`, TEST_EMAIL_DOMAIN, runId), name: "Owner" },
  });
  await dbQuery("membership", "create", { data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  return { org, owner };
}

/** Organization delete cascades Membership and OrganizationOnboardingStep (both `onDelete: Cascade`); the User row is separate. */
async function cleanupFreshOrg({ org, owner }: FreshOrg): Promise<void> {
  await dbQuery("organization", "delete", { where: { id: org.id } });
  await dbQuery("user", "delete", { where: { id: owner.id } });
}

async function addMember(runId: string, organizationId: string, label: string, role: "ADMIN" | "MEMBER") {
  const user = await dbQuery<{ id: string; email: string }>("user", "create", {
    data: { id: randomUUID(), email: testEmail(`onboarding-${label}`, TEST_EMAIL_DOMAIN, runId), name: label },
  });
  await dbQuery("membership", "create", { data: { userId: user.id, organizationId, role } });
  return user;
}

/** The card is a `<section aria-labelledby="onboarding-heading">` — an accessible "region" named after its own heading, so this scopes every assertion to the card alone, never any other content on /dashboard (KPIs, Needs attention, Today, Recent activity). */
function onboardingCard(page: Page) {
  return page.getByRole("region", { name: "Getting started" });
}

/**
 * Stage 6 audit fix regression guard (unchanged from the original
 * suite). `:focus-visible` matching for a *programmatic* `.focus()` call
 * is a browser/automation heuristic that isn't guaranteed consistent —
 * this checks the actual rendered effect instead.
 */
async function hasVisibleFocusIndicator(locator: ReturnType<Page["locator"]>): Promise<boolean> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const hasShadow = style.boxShadow !== "none" && style.boxShadow !== "";
    const hasOutline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
    return hasShadow || hasOutline;
  });
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Visibility and the single primary step", () => {
  test("a fresh, empty organization shows 0 of 5 complete, and Company Profile as the one primary step", async ({
    context,
    baseURL,
    page,
  }) => {
    const fresh = await createFreshOrg(fixtures.runId, "empty");
    await actAsMember(context, baseURL!, fresh.owner, fresh.org.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await expect(onboardingCard(page)).toBeVisible();
    await expect(onboardingCard(page).getByText("0 of 5 complete")).toBeVisible();

    const bar = onboardingCard(page).getByRole("progressbar", { name: "Onboarding progress" });
    await expect(bar).toHaveAttribute("aria-valuenow", "0");

    // Never a checklist of rows — exactly one step is shown.
    await expect(onboardingCard(page).getByRole("listitem")).toHaveCount(0);
    await expect(onboardingCard(page).getByText("Set up company profile")).toBeVisible();
    await expect(onboardingCard(page).getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/settings/company",
    );

    // No legacy/admin steps ever surface on this card.
    for (const legacyLabel of ["Welcome", "Choose an industry preset", "Add payment receiving details", "Review your domain settings", "Review billing", "Finish setup"]) {
      await expect(onboardingCard(page).getByText(legacyLabel)).toHaveCount(0);
    }

    await cleanupFreshOrg(fresh);
  });

  test("a partially-progressed organization shows a partial count and the correct next step, respecting dependency order", async ({
    context,
    baseURL,
    page,
  }) => {
    // orgB (seedTestData()) has exactly one real Client and nothing else.
    await actAsMember(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await expect(onboardingCard(page)).toBeVisible();
    await expect(onboardingCard(page).getByText("1 of 5 complete")).toBeVisible();
    // Client is done; Company Profile (no dependency) is still the first
    // NOT_STARTED step in canonical order, so it — not Project — is next.
    await expect(onboardingCard(page).getByText("Set up company profile")).toBeVisible();
  });

  test("a fully productive organization (every visible step complete/skipped) shows no card at all", async ({
    context,
    baseURL,
    page,
  }) => {
    await dbQuery("organizationProfile", "create", {
      data: { organizationId: fixtures.orgA.id, legalName: "Test Org A LLC", country: "United States", currency: "USD", timezone: "America/New_York" },
    });

    try {
      // fixtures.orgA already has a real Client/Project/Task and a second
      // (accepted) Membership — the last thing missing is Company Profile,
      // added above.
      await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await gotoAndSettle(page, `${baseURL}/dashboard`);
      await expect(onboardingCard(page)).toHaveCount(0);
    } finally {
      await dbQuery("organizationProfile", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    }
  });
});

test.describe("Actions", () => {
  test("clicking 'Get started' navigates to the current step's real route", async ({ context, baseURL, page }) => {
    const fresh = await createFreshOrg(fixtures.runId, "goto");
    await actAsMember(context, baseURL!, fresh.owner, fresh.org.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await onboardingCard(page).getByRole("link", { name: "Get started" }).click();
    await page.waitForURL(/\/settings\/company/);
  });

  test("skipping the Task-or-Invoice step advances the card to the next step in place — no manual reload", async ({
    context,
    baseURL,
    page,
  }) => {
    const fresh = await createFreshOrg(fixtures.runId, "skip");
    await dbQuery("organizationProfile", "create", {
      data: { organizationId: fresh.org.id, legalName: "Skip Test LLC", country: "United States", currency: "USD", timezone: "America/New_York" },
    });
    const client = await dbQuery<{ id: string }>("client", "create", {
      data: { name: "Skip Test Client", organizationId: fresh.org.id, userId: fresh.owner.id },
    });
    const project = await dbQuery<{ id: string }>("project", "create", {
      data: { name: "Skip Test Project", clientId: client.id, ownerId: fresh.owner.id, organizationId: fresh.org.id },
    });

    await actAsMember(context, baseURL!, fresh.owner, fresh.org.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await expect(onboardingCard(page).getByText("Create a task or invoice")).toBeVisible();
    await onboardingCard(page).getByRole("button", { name: /Skip/ }).click();

    await expect(onboardingCard(page).getByText("Invite a teammate or client")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);

    await dbQuery("project", "delete", { where: { id: project.id } });
    await dbQuery("client", "delete", { where: { id: client.id } });
    await dbQuery("organizationProfile", "deleteMany", { where: { organizationId: fresh.org.id } });
    await cleanupFreshOrg(fresh);
  });

  test("dismissing the card hides it in place — no manual reload", async ({ context, baseURL, page }) => {
    const fresh = await createFreshOrg(fixtures.runId, "dismiss");
    await actAsMember(context, baseURL!, fresh.owner, fresh.org.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await expect(onboardingCard(page)).toBeVisible();
    await page.getByRole("button", { name: "Dismiss onboarding" }).click();

    await expect(onboardingCard(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard$/);

    await cleanupFreshOrg(fresh);
  });
});

test.describe("Role-aware Company Profile / Invite steps (locked spec §8)", () => {
  test("OWNER gets an actionable Company Profile CTA", async ({ context, baseURL, page }) => {
    const fresh = await createFreshOrg(fixtures.runId, "role-owner");
    await actAsMember(context, baseURL!, fresh.owner, fresh.org.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await expect(onboardingCard(page).getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/settings/company",
    );
    await expect(onboardingCard(page).getByText("Ask your workspace owner")).toHaveCount(0);

    await cleanupFreshOrg(fresh);
  });

  test("MEMBER sees owner-required messaging for Company Profile, never a CTA that would be rejected", async ({
    context,
    baseURL,
    page,
  }) => {
    const fresh = await createFreshOrg(fixtures.runId, "role-member");
    const member = await addMember(fixtures.runId, fresh.org.id, "role-member", "MEMBER");

    try {
      await actAsMember(context, baseURL!, member, fresh.org.id);
      await gotoAndSettle(page, `${baseURL}/dashboard`);

      await expect(onboardingCard(page).getByText("Set up company profile")).toBeVisible();
      await expect(onboardingCard(page).getByText("Ask your workspace owner to complete the company profile.")).toBeVisible();
      await expect(onboardingCard(page).getByRole("link", { name: "Get started" })).toHaveCount(0);
    } finally {
      await dbQuery("user", "delete", { where: { id: member.id } });
      await cleanupFreshOrg(fresh);
    }
  });

  /**
   * The Invite step's own role-blocked-messaging branch for a MEMBER is
   * fully proven at the pure-function level (test/unit/onboarding-
   * visible-progress.test.ts, "17. MEMBER does not get an actionable
   * Invite CTA") but has no reachable real-browser equivalent: hasSecondMember
   * (the reused, unchanged legacy signal — "True once more than just the
   * creating OWNER holds a Membership") becomes true the instant ANY
   * second staff Membership exists, including the very MEMBER identity
   * that would need to exist to log in and view this state at all — so a
   * real MEMBER can never actually observe the Invite step as NOT_STARTED
   * via a genuine product flow; the moment their own Membership exists,
   * the step is already COMPLETE for everyone. This is a real, correct
   * consequence of reusing the existing signal unchanged (locked spec
   * §2), not a defect — the role check remains real, defensive code for
   * theoretical/future signal combinations, exercised where it can
   * actually be exercised: the pure-function suite.
   */
});

test.describe("Accessibility", () => {
  test("Skip is a real, keyboard-focusable, labeled button — Enter while focused performs the skip", async ({
    context,
    baseURL,
    page,
  }) => {
    const fresh = await createFreshOrg(fixtures.runId, "keyboard");
    await dbQuery("organizationProfile", "create", {
      data: { organizationId: fresh.org.id, legalName: "Keyboard Test LLC", country: "United States", currency: "USD", timezone: "America/New_York" },
    });
    const client = await dbQuery<{ id: string }>("client", "create", {
      data: { name: "Keyboard Test Client", organizationId: fresh.org.id, userId: fresh.owner.id },
    });
    const project = await dbQuery<{ id: string }>("project", "create", {
      data: { name: "Keyboard Test Project", clientId: client.id, ownerId: fresh.owner.id, organizationId: fresh.org.id },
    });

    await actAsMember(context, baseURL!, fresh.owner, fresh.org.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await expect(onboardingCard(page).getByText("Create a task or invoice")).toBeVisible();
    const skipButton = onboardingCard(page).getByRole("button", { name: /Skip/ });
    await skipButton.focus();
    await expect(skipButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(onboardingCard(page).getByText("Invite a teammate or client")).toBeVisible();

    await dbQuery("project", "delete", { where: { id: project.id } });
    await dbQuery("client", "delete", { where: { id: client.id } });
    await dbQuery("organizationProfile", "deleteMany", { where: { organizationId: fresh.org.id } });
    await cleanupFreshOrg(fresh);
  });

  test("the progress bar exposes role=progressbar with correct aria-value bounds and a human-readable aria-valuetext", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    const bar = onboardingCard(page).getByRole("progressbar", { name: "Onboarding progress" });
    await expect(bar).toHaveAttribute("aria-valuemin", "0");
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
    await expect(bar).toHaveAttribute("aria-valuetext", /^\d+ of 5 complete$/);
    const valueNow = await bar.getAttribute("aria-valuenow");
    expect(Number(valueNow)).toBeGreaterThanOrEqual(0);
    expect(Number(valueNow)).toBeLessThanOrEqual(100);
  });

  test("Dismiss is a real, labeled button reachable by keyboard", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    const dismissButton = page.getByRole("button", { name: "Dismiss onboarding" });
    await dismissButton.focus();
    await expect(dismissButton).toBeFocused();
  });

  test("dismissing moves focus to the Dashboard's own heading, with a real visible focus indicator", async ({
    context,
    baseURL,
    page,
  }) => {
    const fresh = await createFreshOrg(fixtures.runId, "dismiss-focus");
    await actAsMember(context, baseURL!, fresh.owner, fresh.org.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await page.getByRole("button", { name: "Dismiss onboarding" }).click();

    await expect(onboardingCard(page)).toHaveCount(0);
    const focusedHeading = page.getByRole("heading", { name: "Dashboard", exact: true });
    await expect(focusedHeading).toBeFocused();
    expect(await hasVisibleFocusIndicator(focusedHeading)).toBe(true);

    await cleanupFreshOrg(fresh);
  });
});

test.describe("Mobile", () => {
  for (const width of [320, 360, 375, 390, 768, 1024]) {
    test(`the card itself collapses to fit ${width}px without its own horizontal overflow`, async ({
      context,
      baseURL,
      page,
    }) => {
      // Scoped to the card's own bounding box, not document.scrollWidth —
      // same reasoning the original suite already established: unrelated
      // Header overflow below ~360px is out of scope here.
      await page.setViewportSize({ width, height: 800 });
      await actAsMember(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
      await gotoAndSettle(page, `${baseURL}/dashboard`);

      await expect(onboardingCard(page)).toBeVisible();
      const box = await onboardingCard(page).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(width + 1);

      // The one visible step's own CTA stays reachable (not clipped/
      // zero-size) at this width.
      await expect(onboardingCard(page).getByRole("link", { name: "Get started" })).toBeVisible();
    });
  }
});

test.describe("Client Portal", () => {
  test("no onboarding card is reachable anywhere from the Client Portal", async ({ context, baseURL, page }) => {
    await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
    await gotoAndSettle(page, `${baseURL}/portal`);
    await expect(onboardingCard(page)).toHaveCount(0);
  });
});
