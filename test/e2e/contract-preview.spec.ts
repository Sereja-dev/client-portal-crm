import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Documents Slice C — Contract Preview V1. Real browser coverage for the
 * new DRAFT-only `/contracts/[id]/preview` route: the primary flow
 * (detail -> Preview -> content -> back), non-DRAFT/archived protection
 * (Preview action absent, direct URL redirects away rather than exposing
 * a live-field view past SEND), tenant isolation (foreign-org/malformed/
 * nonexistent id all 404, Portal identity redirected to /portal before
 * reaching this route at all), responsive behavior at 390/834/1280px,
 * and plain-text/XSS preservation. Domain-layer correctness (the
 * isContractPreviewable() gate itself, the no-mutation/no-snapshot
 * guarantee) is already exhaustively covered by
 * test/integration/contracts/preview.test.ts and is not re-derived here
 * — these tests only prove the UI wires into that already-reviewed
 * backend correctly and renders it truthfully. Mirrors contracts.spec.ts's
 * own exact fixture/session conventions.
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

async function cleanupContracts(): Promise<void> {
  await dbQuery("contract", "deleteMany", { where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
}

function uniqueNumber(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function seedDraftContract(overrides: Record<string, unknown> = {}) {
  return dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
    data: {
      contractNumber: uniqueNumber("C-PREVIEW"),
      title: "Website Redesign Agreement",
      body: "This agreement is entered into by and between the parties.",
      status: "DRAFT",
      issueDate: "2026-06-01T00:00:00.000Z",
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      createdByUserId: fixtures.owner.id,
      internalNotes: "Internal-only chasing note — must never render in Preview.",
      ...overrides,
    },
  });
}

test.describe("Contract Preview (Documents Slice C)", () => {
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

  test("primary flow: DRAFT shows the Preview action, Preview renders the document content without internal notes, and Edit/Send remain available back on the detail page", async ({
    page,
  }) => {
    const contract = await seedDraftContract({
      title: "Master Services Agreement",
      body: "Line one of the body.\nLine two, indented:\n    still line two.",
      effectiveDate: "2026-07-01T00:00:00.000Z",
      expiresAt: "2027-06-01T00:00:00.000Z",
      projectId: fixtures.project.id,
    });

    await page.goto(`/contracts/${contract.id}`);
    const previewLink = page.getByRole("link", { name: "Preview" });
    await expect(previewLink).toBeVisible();
    await previewLink.click();

    await expect(page).toHaveURL(`/contracts/${contract.id}/preview`);
    await expect(page.getByRole("heading", { name: "Contract preview" })).toBeVisible();
    await expect(page.getByText("Sending will freeze the contract document content", { exact: false })).toBeVisible();

    await expect(page.getByText(contract.contractNumber, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Master Services Agreement" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contract details" })).toBeVisible();
    await expect(page.getByRole("link", { name: fixtures.clientA.name })).toBeVisible();
    await expect(page.getByRole("link", { name: fixtures.project.name })).toBeVisible();
    // Effective/expiry dates — scoped to the <dt>/<dd> pair rather than a
    // pinned exact string, since formatDateOnlyForDisplay's own output
    // is locale-dependent (toLocaleDateString); exact formatting is
    // already covered by that helper's own unit tests.
    await expect(page.locator("dt", { hasText: "Effective date" }).locator("xpath=following-sibling::dd[1]")).not.toHaveText("Upon acceptance");
    await expect(page.locator("dt", { hasText: "Expiry date" }).locator("xpath=following-sibling::dd[1]")).not.toHaveText("No expiry set");
    await expect(page.getByRole("heading", { name: "Contract body" })).toBeVisible();
    await expect(page.getByText("Line one of the body.")).toBeVisible();
    await expect(page.getByText("Line two, indented:")).toBeVisible();

    // Internal notes must never appear anywhere on this route.
    await expect(page.getByText("Internal-only chasing note", { exact: false })).toHaveCount(0);
    // Nor Activity, lifecycle, createdBy, or template metadata of any kind
    // — scoped to a heading role specifically, since "Activity" also
    // appears as an unrelated primary-nav link on every dashboard page.
    await expect(page.getByRole("heading", { name: "Activity" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Lifecycle" })).toHaveCount(0);

    await page.getByRole("link", { name: "← Back to contract" }).click();
    await expect(page).toHaveURL(`/contracts/${contract.id}`);
    await expect(page.getByRole("link", { name: "Edit contract" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send contract" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Preview" })).toBeVisible();
  });

  test("a Contract with no Project and no intended signatory previews identically to the detail page's own equivalent fields", async ({ page }) => {
    const contract = await seedDraftContract();
    await page.goto(`/contracts/${contract.id}/preview`);
    await expect(page.locator("dt", { hasText: "Project" }).locator("xpath=following-sibling::dd[1]")).toHaveText("—");
    await expect(page.locator("dt", { hasText: "Intended signatory" }).locator("xpath=following-sibling::dd[1]")).toHaveText("None");
  });

  test("plain-text/XSS: a body containing script-like/markup-like text renders as literal, escaped text — never executable markup", async ({
    page,
  }) => {
    const raw = "<script>alert(1)</script> and <b>bold</b> stay literal";
    const contract = await seedDraftContract({ body: raw, title: "XSS Regression Title <b>unescaped</b>" });

    const alerts: string[] = [];
    page.on("dialog", async (dialog) => {
      alerts.push(dialog.message());
      await dialog.dismiss();
    });

    await page.goto(`/contracts/${contract.id}/preview`);
    const bodyParagraph = page.getByText(raw, { exact: true });
    await expect(bodyParagraph).toBeVisible();
    // Scoped to the body paragraph itself, not the whole page — the
    // page legitimately has its own unrelated <script> tags (Next.js's
    // own hydration bundles); the real assertion is that the body's OWN
    // container never parsed the Contract's content into real script/b
    // elements, which page-wide "renders as literal text" assertion
    // above already proves, but this adds a positive DOM-shape check.
    await expect(bodyParagraph.locator("script")).toHaveCount(0);
    await expect(bodyParagraph.locator("b")).toHaveCount(0);
    expect(alerts).toEqual([]);
  });

  test.describe("non-DRAFT protection", () => {
    test("SENT: no Preview action on the detail page, and the direct preview URL redirects away rather than exposing a live-field view", async ({
      page,
    }) => {
      const contract = await seedDraftContract();
      await dbQuery("contract", "update", {
        where: { id: contract.id },
        data: {
          status: "SENT",
          sentAt: new Date().toISOString(),
          organizationSnapshot: { schemaVersion: 1, legalName: "Frozen Org", address: {}, country: null, taxId: null, supportEmail: null, phone: null, website: null },
          clientSnapshot: { schemaVersion: 1, billingName: "Frozen Client", email: null, address: {}, country: null, taxId: null },
          signatorySnapshot: null,
        },
      });

      await page.goto(`/contracts/${contract.id}`);
      await expect(page.getByRole("link", { name: "Preview" })).toHaveCount(0);

      await page.goto(`/contracts/${contract.id}/preview`);
      await expect(page).toHaveURL(`/contracts/${contract.id}`);
      await expect(page.getByRole("heading", { name: "Sent party details" })).toBeVisible();
    });

    test("ACCEPTED: no Preview action, direct URL redirects away", async ({ page }) => {
      const contract = await seedDraftContract();
      await dbQuery("contract", "update", {
        where: { id: contract.id },
        data: { status: "ACCEPTED", sentAt: new Date().toISOString(), acceptedAt: new Date().toISOString(), acceptedByUserId: fixtures.owner.id },
      });

      await page.goto(`/contracts/${contract.id}`);
      await expect(page.getByRole("link", { name: "Preview" })).toHaveCount(0);

      await page.goto(`/contracts/${contract.id}/preview`);
      await expect(page).toHaveURL(`/contracts/${contract.id}`);
    });

    test("TERMINATED: no Preview action, direct URL redirects away", async ({ page }) => {
      const contract = await seedDraftContract();
      await dbQuery("contract", "update", {
        where: { id: contract.id },
        data: {
          status: "TERMINATED",
          sentAt: new Date().toISOString(),
          acceptedAt: new Date().toISOString(),
          acceptedByUserId: fixtures.owner.id,
          terminatedAt: new Date().toISOString(),
        },
      });

      await page.goto(`/contracts/${contract.id}`);
      await expect(page.getByRole("link", { name: "Preview" })).toHaveCount(0);

      await page.goto(`/contracts/${contract.id}/preview`);
      await expect(page).toHaveURL(`/contracts/${contract.id}`);
    });

    test("archived DRAFT: no Preview action (same convention that already suppresses Edit/Send), direct URL redirects away", async ({ page }) => {
      const contract = await seedDraftContract();
      await dbQuery("contract", "update", { where: { id: contract.id }, data: { archivedAt: new Date().toISOString() } });

      await page.goto(`/contracts/${contract.id}`);
      await expect(page.getByRole("link", { name: "Preview" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Edit contract" })).toHaveCount(0);

      await page.goto(`/contracts/${contract.id}/preview`);
      await expect(page).toHaveURL(`/contracts/${contract.id}`);
    });
  });

  test.describe("tenant isolation", () => {
    test("a foreign-org Contract's preview URL 404s, indistinguishable from a nonexistent one", async ({ page }) => {
      const foreign = await dbQuery<{ id: string }>("contract", "create", {
        data: {
          contractNumber: uniqueNumber("C-ORGB"),
          title: "Org B Secret Contract",
          body: "Body.",
          status: "DRAFT",
          issueDate: "2026-06-01T00:00:00.000Z",
          organizationId: fixtures.orgB.id,
          clientId: fixtures.clientB.id,
          createdByUserId: fixtures.orgBOwner.id,
        },
      });

      const response = await page.goto(`/contracts/${foreign.id}/preview`);
      expect(response?.status()).toBe(404);
      await expect(page.getByText("Org B Secret Contract")).toHaveCount(0);
    });

    test("a nonexistent (well-formed) id 404s", async ({ page }) => {
      const response = await page.goto(`/contracts/00000000-0000-0000-0000-000000000000/preview`);
      expect(response?.status()).toBe(404);
    });

    test("a malformed (non-UUID) id 404s, never a server error boundary", async ({ page }) => {
      const response = await page.goto(`/contracts/not-a-real-uuid/preview`);
      expect(response?.status()).toBe(404);
    });

    test("a Portal identity is redirected to /portal before ever reaching the Staff preview route", async ({ context, baseURL, page }) => {
      const contract = await seedDraftContract();
      await context.clearCookies();
      await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
      await page.goto(`/contracts/${contract.id}/preview`);
      await expect(page).toHaveURL(/\/portal/);
    });
  });

  test.describe("responsive", () => {
    test("390x900: header/document card fit the viewport, long body wraps, no page-level horizontal overflow", async ({ page }) => {
      const contract = await seedDraftContract({
        body: "A very long single line of contract body text meant to exercise wrapping behavior without ever causing the page itself to scroll horizontally, repeated for length: " + "x".repeat(200),
      });
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(`/contracts/${contract.id}/preview`);

      await expect(page.getByRole("heading", { name: "Contract preview" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Contract body" })).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow).toBe(false);

      await expect(page.getByRole("link", { name: "← Back to contract" })).toBeVisible();
    });

    test("834px: document card remains usable, no overflow", async ({ page }) => {
      const contract = await seedDraftContract();
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto(`/contracts/${contract.id}/preview`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      await expect(page.getByRole("heading", { name: "Contract details" })).toBeVisible();
    });

    test("1280px (desktop): no overflow, full content visible", async ({ page }) => {
      const contract = await seedDraftContract();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/contracts/${contract.id}/preview`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      await expect(page.getByRole("heading", { name: "Contract body" })).toBeVisible();
    });
  });
});
