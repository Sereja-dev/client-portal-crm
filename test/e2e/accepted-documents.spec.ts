import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Documents Slice D — Accepted documents. Real browser coverage for
 * `/documents/accepted`: truthful heading/copy (never "signed"/
 * "e-signed"/"certified"/"executed"), persisted-ACCEPTED-only inclusion
 * (DRAFT/SENT/TERMINATED excluded), derived-EXPIRED display for an
 * accepted-but-expired Contract, archived behavior mirroring Contracts'
 * own convention, and the detail link. Domain-layer correctness
 * (persisted-status filtering, tenant isolation) is already exhaustively
 * covered by test/integration/contracts/accepted-documents.test.ts and
 * is not re-derived here. Contracts are seeded directly via dbQuery
 * (direct fixture creation, matching every other Contract E2E spec's own
 * established convention) rather than driving the full Send/Accept UI
 * flow for every status combination.
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

function uniqueNumber(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function cleanupContracts(): Promise<void> {
  await dbQuery("contract", "deleteMany", { where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
}

test.describe("Accepted documents (Documents Slice D)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupContracts();
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupContracts();
  });

  test("empty state, heading, and truthful helper copy — never signed/e-signed/certified/executed terminology", async ({ page }) => {
    await page.goto("/documents/accepted");
    await expect(page.getByRole("heading", { name: "Accepted documents" })).toBeVisible();
    await expect(page.getByText("No accepted documents yet")).toBeVisible();
    await expect(page.getByText("Contracts that have been accepted by Staff or through the client portal.")).toBeVisible();

    for (const forbidden of ["Signed", "signed", "e-signed", "Certified", "certified", "Executed", "executed"]) {
      await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
    }
  });

  test("an ACCEPTED Contract appears with its detail link working", async ({ page }) => {
    const number = uniqueNumber("C-ACCEPTED");
    const contract = await dbQuery<{ id: string }>("contract", "create", {
      data: {
        contractNumber: number,
        title: "Accepted Services Agreement",
        body: "Body.",
        status: "ACCEPTED",
        issueDate: "2026-06-01T00:00:00.000Z",
        sentAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        acceptedByUserId: fixtures.owner.id,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
      },
    });

    await page.goto("/documents/accepted");
    const row = page.getByRole("row", { name: new RegExp(number) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: fixtures.clientA.name })).toBeVisible();

    await row.getByRole("link", { name: "View" }).click();
    await expect(page).toHaveURL(`/contracts/${contract.id}`);
    await expect(page.getByRole("heading", { name: number })).toBeVisible();
  });

  test("an accepted-but-expired Contract appears with display status Expired, never queried/labeled as a stored EXPIRED status", async ({ page }) => {
    const number = uniqueNumber("C-EXPIRED");
    await dbQuery("contract", "create", {
      data: {
        contractNumber: number,
        title: "Expired Services Agreement",
        body: "Body.",
        status: "ACCEPTED",
        issueDate: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-06-01T00:00:00.000Z",
        sentAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        acceptedByUserId: fixtures.owner.id,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
      },
    });

    await page.goto("/documents/accepted");
    const row = page.getByRole("row", { name: new RegExp(number) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Expired", { exact: true })).toBeVisible();
  });

  test("an accepted Contract via Portal acceptance appears identically to a Staff-accepted one", async ({ page }) => {
    const number = uniqueNumber("C-PORTAL-ACCEPTED");
    await dbQuery("contract", "create", {
      data: {
        contractNumber: number,
        title: "Portal Accepted Agreement",
        body: "Body.",
        status: "ACCEPTED",
        issueDate: "2026-06-01T00:00:00.000Z",
        sentAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        acceptedByPortalUserId: fixtures.portalUser.id,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
      },
    });

    await page.goto("/documents/accepted");
    await expect(page.getByRole("row", { name: new RegExp(number) })).toBeVisible();
  });

  test("DRAFT, SENT, and TERMINATED Contracts never appear", async ({ page }) => {
    const draftNumber = uniqueNumber("C-DRAFT");
    const sentNumber = uniqueNumber("C-SENT");
    const terminatedNumber = uniqueNumber("C-TERMINATED");

    await dbQuery("contract", "create", {
      data: {
        contractNumber: draftNumber,
        title: "Draft",
        body: "Body.",
        status: "DRAFT",
        issueDate: "2026-06-01T00:00:00.000Z",
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
      },
    });
    await dbQuery("contract", "create", {
      data: {
        contractNumber: sentNumber,
        title: "Sent",
        body: "Body.",
        status: "SENT",
        issueDate: "2026-06-01T00:00:00.000Z",
        sentAt: new Date().toISOString(),
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
      },
    });
    await dbQuery("contract", "create", {
      data: {
        contractNumber: terminatedNumber,
        title: "Terminated",
        body: "Body.",
        status: "TERMINATED",
        issueDate: "2026-06-01T00:00:00.000Z",
        sentAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        acceptedByUserId: fixtures.owner.id,
        terminatedAt: new Date().toISOString(),
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
      },
    });

    await page.goto("/documents/accepted");
    await expect(page.getByText(draftNumber)).toHaveCount(0);
    await expect(page.getByText(sentNumber)).toHaveCount(0);
    await expect(page.getByText(terminatedNumber)).toHaveCount(0);
  });

  test("a foreign-org ACCEPTED Contract never appears", async ({ page }) => {
    const number = uniqueNumber("C-ORGB-ACCEPTED");
    await dbQuery("contract", "create", {
      data: {
        contractNumber: number,
        title: "Org B Secret Accepted Contract",
        body: "Body.",
        status: "ACCEPTED",
        issueDate: "2026-06-01T00:00:00.000Z",
        sentAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        acceptedByUserId: fixtures.orgBOwner.id,
        organizationId: fixtures.orgB.id,
        clientId: fixtures.clientB.id,
        createdByUserId: fixtures.orgBOwner.id,
      },
    });

    await page.goto("/documents/accepted");
    await expect(page.getByText(number)).toHaveCount(0);
  });

  test("archived behavior mirrors Contracts' own Active/Archived convention", async ({ page }) => {
    const number = uniqueNumber("C-ARCHIVED-ACCEPTED");
    await dbQuery("contract", "create", {
      data: {
        contractNumber: number,
        title: "Archived Accepted Agreement",
        body: "Body.",
        status: "ACCEPTED",
        issueDate: "2026-06-01T00:00:00.000Z",
        sentAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        acceptedByUserId: fixtures.owner.id,
        archivedAt: new Date().toISOString(),
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
      },
    });

    await page.goto("/documents/accepted");
    await expect(page.getByText(number)).toHaveCount(0);

    await page.getByRole("group", { name: "Accepted documents status" }).getByRole("link", { name: "Archived" }).click();
    await expect(page).toHaveURL(/archived=1/);
    await expect(page.getByRole("row", { name: new RegExp(number) })).toBeVisible();
  });

  test.describe("responsive", () => {
    test("390x900: tabs usable, no page-level horizontal overflow", async ({ page }) => {
      const number = uniqueNumber("C-RESP-390");
      await dbQuery("contract", "create", {
        data: {
          contractNumber: number,
          title: "Responsive check with a fairly long title to exercise wrapping",
          body: "Body.",
          status: "ACCEPTED",
          issueDate: "2026-06-01T00:00:00.000Z",
          sentAt: new Date().toISOString(),
          acceptedAt: new Date().toISOString(),
          acceptedByUserId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
          clientId: fixtures.clientA.id,
          createdByUserId: fixtures.owner.id,
        },
      });

      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto("/documents/accepted");
      await expect(page.getByRole("heading", { name: "Accepted documents" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("834px: no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/documents/accepted");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("1280px (desktop): full table visible", async ({ page }) => {
      const number = uniqueNumber("C-RESP-1280");
      await dbQuery("contract", "create", {
        data: {
          contractNumber: number,
          title: "Desktop view",
          body: "Body.",
          status: "ACCEPTED",
          issueDate: "2026-06-01T00:00:00.000Z",
          sentAt: new Date().toISOString(),
          acceptedAt: new Date().toISOString(),
          acceptedByUserId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
          clientId: fixtures.clientA.id,
          createdByUserId: fixtures.owner.id,
        },
      });

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/documents/accepted");
      await expect(page.getByRole("columnheader", { name: "Accepted" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Expiry" })).toBeVisible();
    });
  });
});
