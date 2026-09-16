import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Contracts Portal V1 §29. Real browser coverage for the Portal
 * Contract list/detail rendering, the frozen-snapshot party display, the
 * Accept confirmation flow, DRAFT/archived/cross-client denial, and
 * responsive behavior at 390/834/1280px — mirroring portal-quotes.spec.ts's
 * own exact fixture/session conventions. Portal has NO
 * `active_organization_id` cookie (no org-switcher concept at all — see
 * injectTestSession's own usage below, identical to portal-quotes.spec.ts).
 * Backend rules (race safety, eligibility, tenant isolation, the
 * acceptance-actor invariant, snapshot immutability) are already
 * exhaustively covered by test/integration/contracts/portal-acceptance.test.ts
 * and test/integration/contracts/portal-queries.test.ts and are not
 * re-derived here — these tests only prove the Portal UI wires into that
 * already-reviewed backend correctly and renders it truthfully.
 */

async function actAsPortalUser(context: BrowserContext, baseURL: string, portalUser: { id: string; email: string }): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, portalUser, baseURL);
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

const ORG_SNAPSHOT = {
  schemaVersion: 1,
  legalName: "E2E Org Legal Name LLC",
  address: { streetAddress: null, city: null, state: null, postalCode: null },
  country: null,
  taxId: null,
  supportEmail: null,
  phone: null,
  website: null,
};

function clientSnapshotFor(name: string) {
  return {
    schemaVersion: 1,
    billingName: name,
    email: null,
    address: { streetAddress: null, city: null, state: null, postalCode: null },
    country: null,
    taxId: null,
  };
}

async function seedContract(overrides: Record<string, unknown> = {}) {
  return dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
    data: {
      contractNumber: `E2E-PC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: "Website Redesign Agreement",
      body: "This agreement is entered into by and between the parties.",
      status: "DRAFT",
      issueDate: "2026-06-01T00:00:00.000Z",
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      createdByUserId: fixtures.owner.id,
      ...overrides,
    },
  });
}

async function seedSentContract(overrides: Record<string, unknown> = {}) {
  return seedContract({
    status: "SENT",
    sentAt: new Date().toISOString(),
    organizationSnapshot: ORG_SNAPSHOT,
    clientSnapshot: clientSnapshotFor(fixtures.clientA.name),
    signatorySnapshot: null,
    ...overrides,
  });
}

test.describe("Portal Contracts list & detail", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
  });

  test("own SENT contract is listed and opens, showing body and frozen party snapshot", async ({ page }) => {
    const contract = await seedSentContract();
    try {
      await page.goto("/portal/contracts");
      await expect(page.getByRole("link", { name: contract.contractNumber })).toBeVisible();

      await page.getByRole("link", { name: contract.contractNumber }).click();
      await expect(page).toHaveURL(new RegExp(`/portal/contracts/${contract.id}$`));
      await expect(page.getByText("This agreement is entered into by and between the parties.")).toBeVisible();
      await expect(page.getByText("E2E Org Legal Name LLC")).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept contract" })).toBeVisible();
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });

  test("a DRAFT contract's direct URL is blocked with the same generic not-found used elsewhere in the Portal, and never appears in the list", async ({ page }) => {
    const draft = await seedContract({ status: "DRAFT" });
    try {
      await page.goto(`/portal/contracts/${draft.id}`);
      await expect(page.getByText("Page not found")).toBeVisible();

      await page.goto("/portal/contracts");
      await expect(page.getByRole("link", { name: draft.contractNumber })).toHaveCount(0);
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: draft.id } });
    }
  });

  test("an archived contract never appears in the list or its own direct URL", async ({ page }) => {
    const archived = await seedSentContract({ archivedAt: new Date().toISOString() });
    try {
      await page.goto("/portal/contracts");
      await expect(page.getByRole("link", { name: archived.contractNumber })).toHaveCount(0);

      await page.goto(`/portal/contracts/${archived.id}`);
      await expect(page.getByText("Page not found")).toBeVisible();
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: archived.id } });
    }
  });

  test("a foreign Client's Contract (same org) never appears in the list, and its direct URL 404s for this Portal identity", async ({ page }) => {
    const otherClient = await dbQuery<{ id: string }>("client", "create", {
      data: { name: `E2E PC Other Client ${fixtures.runId}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const contract = await seedSentContract({ clientId: otherClient.id, clientSnapshot: clientSnapshotFor("Other Client") });
    try {
      await page.goto("/portal/contracts");
      await expect(page.getByRole("link", { name: contract.contractNumber })).toHaveCount(0);

      await page.goto(`/portal/contracts/${contract.id}`);
      await expect(page.getByText("Page not found")).toBeVisible();
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
      await dbQuery("client", "deleteMany", { where: { id: otherClient.id } });
    }
  });

  test("internalNotes is never rendered on the detail page, even when set", async ({ page }) => {
    const contract = await seedSentContract();
    await dbQuery("contract", "update", { where: { id: contract.id }, data: { internalNotes: "Sensitive staff-only context." } });
    try {
      await page.goto(`/portal/contracts/${contract.id}`);
      await expect(page.getByText("Sensitive staff-only context")).toHaveCount(0);
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });

  test("the Portal Contract detail page never renders a Staff /clients, /leads, /quotes, or /invoices link", async ({ page }) => {
    const contract = await seedSentContract();
    try {
      await page.goto(`/portal/contracts/${contract.id}`);
      await expect(page.locator('a[href^="/clients/"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/leads/"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/quotes/"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/invoices/"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/contracts/"]')).toHaveCount(0);
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });

  test("the Portal Contracts nav link is present and navigates correctly, without breaking the horizontal nav", async ({ page }) => {
    await page.goto("/portal");
    const nav = page.getByRole("navigation", { name: "Client Portal" });
    await expect(nav.getByRole("link", { name: "Contracts" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Profile" })).toBeVisible();

    await nav.getByRole("link", { name: "Contracts" }).click();
    await expect(page).toHaveURL(/\/portal\/contracts$/);
    await expect(page.getByRole("heading", { name: "Contracts" })).toBeVisible();
  });
});

test.describe("Acceptance", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
  });

  test("Accept requires confirmation naming the contract, discloses no certified electronic signature, and results in Accepted with no more Accept button", async ({ page }) => {
    const contract = await seedSentContract();
    try {
      await page.goto(`/portal/contracts/${contract.id}`);
      await page.getByRole("button", { name: "Accept contract" }).click();

      await expect(page.getByText(new RegExp(contract.contractNumber)).first()).toBeVisible();
      await expect(page.getByText(/does not create a certified electronic signature/i)).toBeVisible();
      await expect(page.getByText(/^Signed by/)).toHaveCount(0);

      await page.getByRole("button", { name: "Accept contract", exact: true }).nth(1).click();
      await expect(page.getByText("Contract accepted")).toBeVisible();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
      await expect(page.getByText(/Accepted through the client portal/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept contract" })).toHaveCount(0);
      await expect(page.getByText(/^Signed by/)).toHaveCount(0);
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });

  test("an already-ACCEPTED contract shows no Accept button", async ({ page }) => {
    const contract = await seedSentContract({
      status: "ACCEPTED",
      acceptedAt: new Date().toISOString(),
      acceptedByPortalUserId: fixtures.portalUser.id,
    });
    try {
      await page.goto(`/portal/contracts/${contract.id}`);
      await expect(page.getByRole("button", { name: "Accept contract" })).toHaveCount(0);
      await expect(page.getByText(/Accepted through the client portal/)).toBeVisible();
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });

  test("a TERMINATED contract shows no Accept button", async ({ page }) => {
    const contract = await seedSentContract({
      status: "TERMINATED",
      acceptedAt: new Date().toISOString(),
      acceptedByPortalUserId: fixtures.portalUser.id,
      terminatedAt: new Date().toISOString(),
    });
    try {
      await page.goto(`/portal/contracts/${contract.id}`);
      await expect(page.getByRole("button", { name: "Accept contract" })).toHaveCount(0);
      await expect(page.getByText("Terminated", { exact: true })).toBeVisible();
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });

  test("a Staff-recorded acceptance shows a neutral truthful phrase, never a Staff name/email", async ({ page }) => {
    const contract = await seedSentContract({
      status: "ACCEPTED",
      acceptedAt: new Date().toISOString(),
      acceptedByUserId: fixtures.owner.id,
    });
    try {
      await page.goto(`/portal/contracts/${contract.id}`);
      await expect(page.getByText("Acceptance recorded by the business")).toBeVisible();
      await expect(page.getByText(fixtures.owner.email)).toHaveCount(0);
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });
});

test.describe("responsive", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
  });

  test("390px: no page-level horizontal overflow on list and detail; accept dialog fits", async ({ page }) => {
    const contract = await seedSentContract();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/portal/contracts");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      await page.goto(`/portal/contracts/${contract.id}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      await page.getByRole("button", { name: "Accept contract" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });

  test("834px: list and detail remain usable, no overflow", async ({ page }) => {
    const contract = await seedSentContract();
    try {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/portal/contracts");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      await page.goto(`/portal/contracts/${contract.id}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await expect(page.getByRole("button", { name: "Accept contract" })).toBeVisible();
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });

  test("1280px: the desktop Portal layout remains coherent, no overflow", async ({ page }) => {
    const contract = await seedSentContract();
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/portal/contracts");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await expect(page.getByRole("link", { name: contract.contractNumber })).toBeVisible();

      await page.goto(`/portal/contracts/${contract.id}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    } finally {
      await dbQuery("contract", "deleteMany", { where: { id: contract.id } });
    }
  });
});
