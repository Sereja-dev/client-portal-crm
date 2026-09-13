import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Sale-Ready Phase C, PR3.2 (Organization Explorer — list UI) and PR3.3
 * (Organization Details — extends this same file rather than adding a
 * new one, since both are the same "Organization Explorer" feature area;
 * PR2's Dashboard got its own file because it's a genuinely separate
 * feature, not because every PR does). Guard/nav coverage already lives
 * in platform-admin.spec.ts and isn't repeated here.
 */

const PLATFORM_ADMIN_EMAIL = "platform-admin-e2e@example.com";
const BASE_PATH = "/platform-admin/organizations";

let fixtures: TestFixtures;
// SeededOrg (test/fixtures/seed.ts) only exposes { id, slug } — the real
// `name` column exists on every seeded row (seed.ts creates orgA/orgB
// with real names) but isn't part of that fixture type, so it's fetched
// once here rather than hardcoding what seed.ts happens to name them.
let orgAName: string;
let orgBName: string;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
  const [orgA, orgB] = await Promise.all([
    dbQuery<{ name: string }>("organization", "findUniqueOrThrow", { where: { id: fixtures.orgA.id }, select: { name: true } }),
    dbQuery<{ name: string }>("organization", "findUniqueOrThrow", { where: { id: fixtures.orgB.id }, select: { name: true } }),
  ]);
  orgAName = orgA.name;
  orgBName = orgB.name;
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

async function asAdmin(context: BrowserContext, baseURL: string): Promise<Page> {
  await injectTestSession(context, { id: `e2e-platform-admin-orgs-${randomUUID()}`, email: PLATFORM_ADMIN_EMAIL }, baseURL);
  return context.newPage();
}

/**
 * Auto-provisions a brand-new Organization (same real mechanism as
 * platform-admin-dashboard.spec.ts's own "registering a brand-new
 * organization" test — a fresh identity's first staff-page visit), then
 * renames it and optionally attaches a Subscription row, so tests can
 * exercise a specific lifecycle bucket without hand-writing every FK this
 * codebase's own Organization/Membership/Subscription graph requires.
 */
async function createTestOrganization(
  context: BrowserContext,
  baseURL: string,
  opts: { name: string; subscription?: Record<string, unknown>; createdAt?: string },
): Promise<{ organizationId: string; userId: string }> {
  const userId = randomUUID();
  const email = `e2e-org-${randomUUID()}@example.com`;
  await injectTestSession(context, { id: userId, email }, baseURL);
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.close();

  const membership = await dbQuery<{ organizationId: string }>("membership", "findFirstOrThrow", {
    where: { userId, role: "OWNER" },
  });
  const organizationId = membership.organizationId;

  await dbQuery("organization", "update", {
    where: { id: organizationId },
    data: { name: opts.name, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) },
  });

  if (opts.subscription) {
    const now = new Date().toISOString();
    await dbQuery("subscription", "deleteMany", { where: { organizationId } });
    await dbQuery("subscription", "create", {
      data: { organizationId, planKey: "STARTER", trialStartedAt: now, trialEndsAt: now, ...opts.subscription },
    });
  }

  return { organizationId, userId };
}

async function cleanupTestOrganization(org: { organizationId: string; userId: string }): Promise<void> {
  await dbQuery("organization", "delete", { where: { id: org.organizationId } });
  await dbQuery("user", "delete", { where: { id: org.userId } });
}

test.describe("Table structure", () => {
  test("every required column header is present at desktop width, and a row renders every field", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE_PATH);

    for (const label of ["Organization", "Owner", "Lifecycle", "Access mode", "Staff", "Portal users", "Clients", "Projects", "Created", "Actions"]) {
      await expect(page.getByRole("columnheader", { name: label })).toBeVisible();
    }

    const row = page.getByRole("row", { name: new RegExp(orgAName) });
    await expect(row).toBeVisible();
    await expect(row.getByText(fixtures.owner.email)).toBeVisible();
    await expect(row.getByRole("link", { name: /View/ })).toBeVisible();
  });
});

test.describe("Search", () => {
  test("matches by organization name", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(`${BASE_PATH}?q=${encodeURIComponent(orgAName)}`);
    await expect(page.getByRole("row", { name: new RegExp(orgAName) })).toBeVisible();
    await expect(page.getByText(orgBName)).toHaveCount(0);
  });

  test("matches by slug", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    const slugFragment = fixtures.orgA.slug.split("-")[0];
    await page.goto(`${BASE_PATH}?q=${encodeURIComponent(slugFragment)}`);
    await expect(page.getByRole("row", { name: new RegExp(orgAName) })).toBeVisible();
  });

  test("matches by owner email, and the search form itself works end to end", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(BASE_PATH);
    await page.getByLabel("Search").fill(fixtures.owner.email);
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(new RegExp(`q=${encodeURIComponent(fixtures.owner.email)}`));
    await expect(page.getByRole("row", { name: new RegExp(orgAName) })).toBeVisible();
  });
});

test.describe("Filters", () => {
  test("the Status dropdown lists All plus all seven lifecycle buckets", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(BASE_PATH);
    const select = page.getByLabel("Status");
    for (const label of ["All", "Legacy", "Trial", "Paid", "Expired", "Suspended", "Canceled", "Archived"]) {
      await expect(select.locator("option", { hasText: label })).toHaveCount(1);
    }
  });

  test("Legacy includes an organization with no Subscription row", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(`${BASE_PATH}?status=LEGACY`);
    await expect(page.getByRole("row", { name: new RegExp(orgAName) })).toBeVisible();
  });

  test("Trial includes a real TRIALING organization and excludes it from Legacy, and the dropdown itself drives navigation", async ({
    context,
    baseURL,
  }) => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const org = await createTestOrganization(context, baseURL!, {
      name: `E2E Trial Org ${randomUUID()}`,
      subscription: { status: "TRIALING", trialEndsAt: future },
    });

    try {
      const page = await asAdmin(context, baseURL!);
      await page.goto(BASE_PATH);
      await page.getByLabel("Status").selectOption("TRIAL");
      await page.waitForURL(/status=TRIAL/);
      await expect(page.getByRole("row").filter({ hasText: /E2E Trial Org/ })).toBeVisible();

      await page.goto(`${BASE_PATH}?status=LEGACY`);
      await expect(page.getByRole("row").filter({ hasText: /E2E Trial Org/ })).toHaveCount(0);
    } finally {
      await cleanupTestOrganization(org);
    }
  });

  test("Archived always shows the empty state — no archiving concept exists in this schema yet", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(`${BASE_PATH}?status=ARCHIVED`);
    await expect(page.getByText("No organizations in this status")).toBeVisible();
    await expect(page.getByText(/No organizations are currently Archived/)).toBeVisible();
  });
});

test.describe("Sorting", () => {
  test("Name (A–Z) sorts alphabetically", async ({ context, baseURL }) => {
    const first = await createTestOrganization(context, baseURL!, { name: `AAA E2E Sort ${randomUUID()}` });
    const second = await createTestOrganization(context, baseURL!, { name: `ZZZ E2E Sort ${randomUUID()}` });
    try {
      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}?sort=name:asc&q=E2E Sort`);
      const names = await page.locator("tbody tr td:first-child").allTextContents();
      const firstIndex = names.findIndex((t) => t.includes("AAA E2E Sort"));
      const secondIndex = names.findIndex((t) => t.includes("ZZZ E2E Sort"));
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThan(firstIndex);
    } finally {
      await cleanupTestOrganization(first);
      await cleanupTestOrganization(second);
    }
  });

  test("Newest first and Oldest first order by createdAt", async ({ context, baseURL }) => {
    const older = await createTestOrganization(context, baseURL!, {
      name: `E2E Newest Old ${randomUUID()}`,
      createdAt: new Date("2020-01-01").toISOString(),
    });
    const newer = await createTestOrganization(context, baseURL!, {
      name: `E2E Newest New ${randomUUID()}`,
      createdAt: new Date("2020-06-01").toISOString(),
    });
    try {
      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}?sort=createdAt:desc&q=E2E Newest`);
      let names = await page.locator("tbody tr td:first-child").allTextContents();
      expect(names.findIndex((t) => t.includes("E2E Newest New"))).toBeLessThan(names.findIndex((t) => t.includes("E2E Newest Old")));

      await page.goto(`${BASE_PATH}?sort=createdAt:asc&q=E2E Newest`);
      names = await page.locator("tbody tr td:first-child").allTextContents();
      expect(names.findIndex((t) => t.includes("E2E Newest Old"))).toBeLessThan(names.findIndex((t) => t.includes("E2E Newest New")));
    } finally {
      await cleanupTestOrganization(older);
      await cleanupTestOrganization(newer);
    }
  });
});

test.describe("Pagination", () => {
  test("crossing the page-size boundary shows Next/Previous correctly and splits rows across pages", async ({ context, baseURL }) => {
    const runId = randomUUID();
    const created: { organizationId: string; userId: string }[] = [];
    try {
      for (let i = 0; i < 11; i++) {
        created.push(
          await createTestOrganization(context, baseURL!, {
            name: `E2E Page ${String(i).padStart(2, "0")} ${runId}`,
            createdAt: new Date(2021, 0, i + 1).toISOString(),
          }),
        );
      }

      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}?q=${encodeURIComponent(runId)}&sort=createdAt:asc`);
      await expect(page.locator("tbody tr")).toHaveCount(10);
      await expect(page.getByText("Page 1 of 2")).toBeVisible();
      await expect(page.getByRole("link", { name: "Next" })).toBeVisible();
      await expect(page.getByText("Previous")).toBeVisible();

      await page.getByRole("link", { name: "Next" }).click();
      await page.waitForURL(/page=2/);
      await expect(page.locator("tbody tr")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();
    } finally {
      for (const org of created) await cleanupTestOrganization(org);
    }
  });
});

test.describe("Empty states", () => {
  test("no search results explains why, and offers Clear search", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(`${BASE_PATH}?q=zzz-definitely-no-such-organization-zzz`);
    await expect(page.getByText("No matching organizations")).toBeVisible();
    await expect(page.getByText(/No organizations match "zzz-definitely-no-such-organization-zzz"/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear search" })).toBeVisible();
  });

  test("no organizations for a filter explains why, and offers Clear filter", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(`${BASE_PATH}?status=ARCHIVED`);
    await expect(page.getByText("No organizations in this status")).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filter" })).toBeVisible();
  });
});

test.describe("Responsive behavior", () => {
  test("desktop (1280px) shows every column", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE_PATH);
    for (const label of ["Owner", "Access mode", "Staff", "Clients", "Projects", "Created"]) {
      await expect(page.getByRole("columnheader", { name: label })).toBeVisible();
    }
  });

  test("tablet (834px) hides desktop-only columns but keeps the reduced set", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.setViewportSize({ width: 834, height: 900 });
    await page.goto(BASE_PATH);
    await expect(page.getByRole("columnheader", { name: "Owner" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Access mode" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Clients" })).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "Created" })).toBeHidden();
  });

  test("mobile (375px) reduces to Organization, Lifecycle, and Actions only, with no page-level horizontal overflow", async ({
    context,
    baseURL,
  }) => {
    const page = await asAdmin(context, baseURL!);
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(BASE_PATH);
    await expect(page.getByRole("columnheader", { name: "Organization" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Lifecycle" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Owner" })).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "Clients" })).toBeHidden();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});

test.describe("Accessibility", () => {
  test("the table uses real semantics, and the toolbar/table/pagination are keyboard-reachable in order", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(BASE_PATH);

    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Organization" })).toBeVisible();

    await page.getByLabel("Search").focus();
    await expect(page.getByLabel("Search")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Status")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Sort by")).toBeFocused();
  });
});

test.describe("Organization Details (PR3.3)", () => {
  const SECTION_TITLES = ["Business Identity", "Subscription", "Organization", "Team", "Usage", "Clients", "Projects", "Recent Activity"];

  test("renders every section, with correct heading hierarchy, for a real seeded organization", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(`${BASE_PATH}/${fixtures.orgA.id}`);

    await expect(page.getByRole("heading", { level: 1, name: orgAName })).toBeVisible();
    for (const title of SECTION_TITLES) {
      await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
      await expect(page.getByRole("region", { name: title })).toBeVisible();
    }

    // Organization section: real, non-fabricated counts.
    const orgSection = page.getByRole("region", { name: "Organization" });
    await expect(orgSection.getByText(fixtures.owner.name)).toBeVisible();
    await expect(orgSection.getByText(fixtures.owner.email)).toBeVisible();

    // fixtures don't seed an OrganizationProfile row for orgA — every
    // optional Business Identity field must honestly say "Not set", never
    // blank or fabricated.
    const identitySection = page.getByRole("region", { name: "Business Identity" });
    await expect(identitySection.getByText(orgAName)).toBeVisible(); // displayName falls back to Organization.name
    await expect(identitySection.getByText("No logo uploaded")).toBeVisible();

    // fixtures DO seed one real Activity row tied to orgA — must render
    // as a real entry, not the empty state.
    const activitySection = page.getByRole("region", { name: "Recent Activity" });
    await expect(activitySection.getByText("No activity yet")).toHaveCount(0);

    // Team section: all three real seeded memberships (owner/admin/member),
    // each with its own name, email, and role — already-fetched data the
    // page previously computed (staff.length only) but never rendered.
    const teamSection = page.getByRole("region", { name: "Team" });
    for (const user of [fixtures.owner, fixtures.admin, fixtures.member]) {
      await expect(teamSection.getByText(user.name)).toBeVisible();
      await expect(teamSection.getByText(user.email)).toBeVisible();
    }
    await expect(teamSection.getByText("Owner", { exact: true })).toBeVisible();
    await expect(teamSection.getByText("Admin", { exact: true })).toBeVisible();
    await expect(teamSection.getByText("Member", { exact: true })).toBeVisible();

    // Clients/Projects previews: the real seeded clientA/project, already
    // fetched (as a capped preview) but never rendered before this PR.
    const clientsSection = page.getByRole("region", { name: "Clients" });
    await expect(clientsSection.getByText(fixtures.clientA.name)).toBeVisible();
    const projectsSection = page.getByRole("region", { name: "Projects" });
    await expect(projectsSection.getByText(fixtures.project.name)).toBeVisible();

    // No internal identifier (User id, Client id, Project id) ever appears
    // as visible text anywhere on the page — React `key` props are never
    // serialized into the DOM, but this is an explicit, direct proof, not
    // an assumption.
    const bodyText = await page.locator("body").innerText();
    for (const id of [fixtures.owner.id, fixtures.admin.id, fixtures.member.id, fixtures.clientA.id, fixtures.project.id]) {
      expect(bodyText).not.toContain(id);
    }
  });

  test("Business Identity shows real data once a profile exists, including logo and brand color", async ({ context, baseURL }) => {
    const org = await createTestOrganization(context, baseURL!, { name: `E2E Identity Org ${randomUUID()}` });
    try {
      await dbQuery("organizationProfile", "create", {
        data: {
          organizationId: org.organizationId,
          legalName: "E2E Identity Org LLC",
          country: "United States",
          currency: "USD",
          timezone: "America/New_York",
          website: "https://example.com",
          supportEmail: "support@example.com",
          phone: "+1 555-0100",
          taxId: "12-3456789",
          streetAddress: "123 Main St",
          city: "Springfield",
          state: "IL",
          postalCode: "62701",
          brandColor: "#3366FF",
          logoUrl: "https://example.com/logo.png",
        },
      });

      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}/${org.organizationId}`);
      const identitySection = page.getByRole("region", { name: "Business Identity" });

      await expect(identitySection.getByText("E2E Identity Org LLC")).toBeVisible();
      await expect(identitySection.getByRole("link", { name: "https://example.com" })).toBeVisible();
      await expect(identitySection.getByText("support@example.com")).toBeVisible();
      await expect(identitySection.getByText("123 Main St, Springfield, IL, 62701")).toBeVisible();
      await expect(identitySection.getByText("#3366FF")).toBeVisible();
      await expect(identitySection.getByRole("img")).toHaveAttribute("src", "https://example.com/logo.png");
    } finally {
      await dbQuery("organizationProfile", "deleteMany", { where: { organizationId: org.organizationId } });
      await cleanupTestOrganization(org);
    }
  });

  test("Recent Activity renders an honest empty state for a brand-new organization with no activity yet", async ({ context, baseURL }) => {
    const org = await createTestOrganization(context, baseURL!, { name: `E2E No Activity Org ${randomUUID()}` });
    try {
      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}/${org.organizationId}`);
      const activitySection = page.getByRole("region", { name: "Recent Activity" });
      await expect(activitySection.getByText("No activity yet")).toBeVisible();
    } finally {
      await cleanupTestOrganization(org);
    }
  });

  test.describe("Support context — Team, Clients, and Projects previews", () => {
    test("Team shows the sole auto-provisioned owner, and Clients/Projects show an honest empty state for a brand-new organization", async ({
      context,
      baseURL,
    }) => {
      const org = await createTestOrganization(context, baseURL!, { name: `E2E No Support Context Org ${randomUUID()}` });
      try {
        const page = await asAdmin(context, baseURL!);
        await page.goto(`${BASE_PATH}/${org.organizationId}`);

        const teamSection = page.getByRole("region", { name: "Team" });
        await expect(teamSection.getByText("Owner", { exact: true })).toBeVisible();
        await expect(teamSection.getByText("No staff members")).toHaveCount(0);

        const clientsSection = page.getByRole("region", { name: "Clients" });
        await expect(clientsSection.getByText("No clients yet")).toBeVisible();

        const projectsSection = page.getByRole("region", { name: "Projects" });
        await expect(projectsSection.getByText("No projects yet")).toBeVisible();
      } finally {
        await cleanupTestOrganization(org);
      }
    });

    test("Clients preview is capped at 10, ordered newest-first, and the total honestly reflects all 11 real rows", async ({
      context,
      baseURL,
    }) => {
      const org = await createTestOrganization(context, baseURL!, { name: `E2E Client Cap Org ${randomUUID()}` });
      const clientIds: string[] = [];
      try {
        // 11 real Client rows, each createdAt one day apart — one more
        // than PREVIEW_TAKE (10), so the cap and "newest first" ordering
        // are both genuinely exercised, not just asserted against a
        // trivially-small fixture.
        for (let i = 0; i < 11; i++) {
          const client = await dbQuery<{ id: string }>("client", "create", {
            data: {
              name: `E2E Cap Client ${String(i).padStart(2, "0")}`,
              organizationId: org.organizationId,
              userId: org.userId,
              createdAt: new Date(2022, 0, i + 1).toISOString(),
            },
          });
          clientIds.push(client.id);
        }

        const page = await asAdmin(context, baseURL!);
        await page.goto(`${BASE_PATH}/${org.organizationId}`);
        const clientsSection = page.getByRole("region", { name: "Clients" });

        // Exactly 10 rows rendered (the cap), and the honest "10 of 11"
        // count is shown — never silently implying only 10 clients exist.
        await expect(clientsSection.getByText(/10 of 11/)).toBeVisible();
        await expect(clientsSection.getByText("E2E Cap Client 10")).toBeVisible(); // newest (i=10)
        await expect(clientsSection.getByText("E2E Cap Client 00")).toHaveCount(0); // oldest (i=0), excluded by the cap
      } finally {
        await dbQuery("client", "deleteMany", { where: { id: { in: clientIds } } });
        await cleanupTestOrganization(org);
      }
    });

    test("Team, Clients, and Projects previews contain no mutation, edit, delete, impersonate, or export control", async ({
      context,
      baseURL,
    }) => {
      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}/${fixtures.orgA.id}`);

      for (const sectionName of ["Team", "Clients", "Projects"]) {
        const section = page.getByRole("region", { name: sectionName });
        await expect(section.getByRole("button")).toHaveCount(0);
        for (const forbidden of ["Edit", "Delete", "Remove", "Suspend", "Impersonate", "Export", "Sign in as"]) {
          await expect(section.getByRole("link", { name: forbidden })).toHaveCount(0);
        }
      }
    });

    test("no horizontal page overflow at narrow, intermediate, and wide viewports", async ({ context, baseURL }) => {
      const page = await asAdmin(context, baseURL!);
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${BASE_PATH}/${fixtures.orgA.id}`);
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `width=${width}`).toBeLessThanOrEqual(clientWidth);
      }
    });
  });

  test("Subscription section reflects a real TRIALING subscription — Lifecycle badge matches the list page's own classification", async ({
    context,
    baseURL,
  }) => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const org = await createTestOrganization(context, baseURL!, {
      name: `E2E Detail Trial Org ${randomUUID()}`,
      subscription: { status: "TRIALING", trialEndsAt: future },
    });
    try {
      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}/${org.organizationId}`);
      const subscriptionSection = page.getByRole("region", { name: "Subscription" });
      await expect(subscriptionSection.getByText("Trial", { exact: true })).toBeVisible();
      await expect(subscriptionSection.getByText("Full Access")).toBeVisible();
    } finally {
      await cleanupTestOrganization(org);
    }
  });

  test("an unknown organization id renders a real 404, not a crash", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(`${BASE_PATH}/00000000-0000-0000-0000-000000000000`);
    await expect(page.getByRole("heading", { name: "Organization not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Organizations" })).toBeVisible();
  });

  test("the View link from the list page reaches the real detail page", async ({ context, baseURL }) => {
    const page = await asAdmin(context, baseURL!);
    await page.goto(BASE_PATH);
    const row = page.getByRole("row", { name: new RegExp(orgAName) });
    await row.getByRole("link", { name: /View/ }).click();
    await page.waitForURL(new RegExp(`${BASE_PATH}/${fixtures.orgA.id}$`));
    // Stability Correction F3 (hardening against an observed CI flake, not
    // locally reproduced): `waitForURL` above only proves the URL
    // changed, not that this detail route's own async Server Component
    // render (it has its own loading.tsx Suspense boundary) has settled —
    // the default 5s assertion timeout was the one previously used here,
    // tighter than most other readiness checks in this suite. The
    // assertion itself — correct heading level and organization name — is
    // unchanged; only its own timeout is extended under constrained CI CPU.
    await expect(page.getByRole("heading", { level: 1, name: orgAName })).toBeVisible({ timeout: 15_000 });
  });

  test("an ordinary tenant user is redirected away from an organization detail page too", async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
    const page = await context.newPage();
    await page.goto(`${BASE_PATH}/${fixtures.orgA.id}`);
    await page.waitForURL(/\/dashboard$/);
  });

  test.describe("PLATFORM_ADMIN_EXECUTION_AUTHORIZATION_AUDIT correction — route-level regression", () => {
    // getOrganizationDetail() now guards its own execution (see that
    // module's own doc comment) — these prove the externally-observable
    // HTTP contract this fix must NOT change: still a clean, generic
    // redirect for every unauthorized identity, for both an invalid and a
    // real valid organization id, never a 500, never any id/error detail
    // in the response. What this file cannot prove — that the underlying
    // Prisma calls are now skipped — is proven instead by
    // test/integration/platform-admin/execution-authorization.test.ts's
    // own direct query-spy tests (see that file's own evidence-boundary
    // comment on why cross-process query counting isn't attempted here).

    test("unauthenticated + invalid id: still a clean, generic redirect to /login", async ({ page, baseURL }) => {
      const res = await page.request.get(`${baseURL}${BASE_PATH}/definitely-invalid-test-id`, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      // Staff session-loss UX fix — see platform-admin.spec.ts's own
      // identical comment.
      expect(res.headers()["location"]).toBe("/login?reason=session_expired");
    });

    test("unauthenticated + a real, valid organization id: still a clean, generic redirect to /login", async ({ page, baseURL }) => {
      const res = await page.request.get(`${baseURL}${BASE_PATH}/${fixtures.orgA.id}`, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toBe("/login?reason=session_expired");
    });

    test("authenticated non-admin + invalid id: still a clean, generic redirect to /dashboard", async ({ context, baseURL }) => {
      await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
      const page = await context.newPage();
      const res = await page.request.get(`${baseURL}${BASE_PATH}/definitely-invalid-test-id`, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toBe("/dashboard");
    });

    test("authenticated non-admin + a real, valid organization id: still a clean, generic redirect to /dashboard", async ({
      context,
      baseURL,
    }) => {
      await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
      const page = await context.newPage();
      const res = await page.request.get(`${baseURL}${BASE_PATH}/${fixtures.orgA.id}`, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toBe("/dashboard");
    });

    test("allowlisted admin: a real organization still renders normally after the fix", async ({ context, baseURL }) => {
      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}/${fixtures.orgA.id}`);
      await expect(page.getByRole("heading", { level: 1, name: orgAName })).toBeVisible();
    });

    test("allowlisted admin: an unknown (but validly-shaped) id still renders the existing honest 404, not a crash", async ({
      context,
      baseURL,
    }) => {
      const page = await asAdmin(context, baseURL!);
      await page.goto(`${BASE_PATH}/00000000-0000-0000-0000-000000000000`);
      await expect(page.getByRole("heading", { name: "Organization not found" })).toBeVisible();
    });
  });
});
