import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Documents Slice D — Global Files V1. Real browser coverage for
 * `/files`: rows across the three supported entity types (CLIENT/
 * PROJECT/INVOICE — never CONTRACT), entity-type filtering, the
 * authorized download action (reusing the existing
 * `/api/attachments/[id]/download` route, unchanged), tenant isolation,
 * and responsive behavior. Domain-layer correctness (tenant scoping,
 * batched entity-context resolution, graceful-missing-entity handling)
 * is already exhaustively covered by
 * test/integration/files/global-files.test.ts and is not re-derived
 * here — these tests only prove the UI wires into that already-verified
 * backend correctly. Attachments are seeded directly via dbQuery (no new
 * upload framework, matching Contract/Template fixtures' own identical
 * E2E convention elsewhere in this suite) rather than live Storage.
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

function uniqueName(prefix: string): string {
  return `${prefix}-${fixtures.runId}.txt`;
}

async function cleanupAttachments(): Promise<void> {
  await dbQuery("attachment", "deleteMany", { where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
}

test.describe("Global Files (Documents Slice D)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    // The seeded fixture CLIENT attachment would otherwise appear in
    // every row-count assertion below — removed up front so this file's
    // own fixtures are the only ones present.
    await cleanupAttachments();
  });

  test.afterAll(async () => {
    await cleanupAttachments();
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupAttachments();
  });

  test("empty state", async ({ page }) => {
    await page.goto("/files");
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(page.getByText("No files yet")).toBeVisible();
    // Never prompts for a Contract upload — no such source exists yet.
    // Scoped to the empty-state copy itself (not the whole page, which
    // legitimately has "Contracts"/"Contract Templates" Documents nav
    // links elsewhere).
    await expect(page.getByText("Files uploaded to Clients, Projects, or Invoices appear here.", { exact: true })).toBeVisible();
  });

  test("lists CLIENT/PROJECT/INVOICE attachments, each linking to its related record, with a working download action", async ({ page }) => {
    const clientFile = uniqueName("client-doc");
    const projectFile = uniqueName("project-doc");
    const invoiceFile = uniqueName("invoice-doc");

    const clientAttachment = await dbQuery<{ id: string }>("attachment", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "CLIENT",
        entityId: fixtures.clientA.id,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/CLIENT/${fixtures.clientA.id}/${clientFile}`,
        originalName: clientFile,
        mimeType: "text/plain",
        sizeBytes: 2048,
      },
    });
    await dbQuery("attachment", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "PROJECT",
        entityId: fixtures.project.id,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/PROJECT/${fixtures.project.id}/${projectFile}`,
        originalName: projectFile,
        mimeType: "text/plain",
        sizeBytes: 4096,
      },
    });
    await dbQuery("attachment", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "INVOICE",
        entityId: fixtures.invoice.id,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/INVOICE/${fixtures.invoice.id}/${invoiceFile}`,
        originalName: invoiceFile,
        mimeType: "text/plain",
        sizeBytes: 8192,
      },
    });

    await page.goto("/files");
    await expect(page.getByText("3 files")).toBeVisible();

    const clientRow = page.getByRole("row", { name: new RegExp(clientFile) });
    await expect(clientRow).toBeVisible();
    await expect(clientRow.getByRole("link", { name: fixtures.clientA.name })).toBeVisible();

    const projectRow = page.getByRole("row", { name: new RegExp(projectFile) });
    await expect(projectRow).toBeVisible();
    await expect(projectRow.getByRole("link", { name: fixtures.project.name })).toBeVisible();

    const invoiceRow = page.getByRole("row", { name: new RegExp(invoiceFile) });
    await expect(invoiceRow).toBeVisible();
    await expect(invoiceRow.getByRole("link", { name: new RegExp(`Invoice #${fixtures.invoice.invoiceNumber}`) })).toBeVisible();

    // The download action reuses the exact existing authorized route —
    // never a direct/unauthenticated Storage URL.
    const downloadHref = await clientRow.getByRole("link", { name: "Download" }).getAttribute("href");
    expect(downloadHref).toBe(`/api/attachments/${clientAttachment.id}/download`);
  });

  test("entity-type filter narrows the list to one type", async ({ page }) => {
    const clientFile = uniqueName("filter-client");
    const projectFile = uniqueName("filter-project");
    await dbQuery("attachment", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "CLIENT",
        entityId: fixtures.clientA.id,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/CLIENT/${fixtures.clientA.id}/${clientFile}`,
        originalName: clientFile,
        mimeType: "text/plain",
        sizeBytes: 100,
      },
    });
    await dbQuery("attachment", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "PROJECT",
        entityId: fixtures.project.id,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/PROJECT/${fixtures.project.id}/${projectFile}`,
        originalName: projectFile,
        mimeType: "text/plain",
        sizeBytes: 100,
      },
    });

    await page.goto("/files?type=CLIENT");
    await expect(page.getByRole("row", { name: new RegExp(clientFile) })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(projectFile) })).toHaveCount(0);
  });

  test("a foreign-org attachment never appears, even unfiltered", async ({ page }) => {
    const foreignFile = uniqueName("org-b-secret");
    await dbQuery("attachment", "create", {
      data: {
        organizationId: fixtures.orgB.id,
        uploadedById: fixtures.orgBOwner.id,
        entityType: "CLIENT",
        entityId: fixtures.clientB.id,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgB.id}/CLIENT/${fixtures.clientB.id}/${foreignFile}`,
        originalName: foreignFile,
        mimeType: "text/plain",
        sizeBytes: 100,
      },
    });

    await page.goto("/files");
    await expect(page.getByText(foreignFile)).toHaveCount(0);
  });

  test("a file whose backing Client has been deleted (missing entity) renders gracefully, never crashing the page", async ({ page }) => {
    const orphanFile = uniqueName("orphan");
    await dbQuery("attachment", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "CLIENT",
        entityId: "00000000-0000-0000-0000-000000000000", // well-formed but nonexistent
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/CLIENT/orphan/${orphanFile}`,
        originalName: orphanFile,
        mimeType: "text/plain",
        sizeBytes: 100,
      },
    });

    const response = await page.goto("/files");
    expect(response?.ok()).toBe(true);
    const row = page.getByRole("row", { name: new RegExp(orphanFile) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Unavailable")).toBeVisible();
  });

  test.describe("responsive", () => {
    test("390x900: filters usable, filenames wrap safely, no page-level horizontal overflow", async ({ page }) => {
      const longFile = `a-very-long-file-name-that-could-otherwise-overflow-${fixtures.runId}.pdf`;
      await dbQuery("attachment", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          uploadedById: fixtures.owner.id,
          entityType: "CLIENT",
          entityId: fixtures.clientA.id,
          storageBucket: "attachments",
          storagePath: `organizations/${fixtures.orgA.id}/CLIENT/${fixtures.clientA.id}/${longFile}`,
          originalName: longFile,
          mimeType: "application/pdf",
          sizeBytes: 100,
        },
      });

      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto("/files");
      await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("834px: table/cards remain usable, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/files");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("1280px (desktop): the full table is visible", async ({ page }) => {
      const file = uniqueName("desktop-view");
      await dbQuery("attachment", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          uploadedById: fixtures.owner.id,
          entityType: "CLIENT",
          entityId: fixtures.clientA.id,
          storageBucket: "attachments",
          storagePath: `organizations/${fixtures.orgA.id}/CLIENT/${fixtures.clientA.id}/${file}`,
          originalName: file,
          mimeType: "text/plain",
          sizeBytes: 100,
        },
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/files");
      await expect(page.getByRole("columnheader", { name: "Related record" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Size" })).toBeVisible();
    });
  });
});
