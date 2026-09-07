import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Stability Correction F4 — behavior-level E2E coverage for the shared
 * ConfirmDialog (src/components/ui/confirm-dialog.tsx) and its
 * destructive-action consumers.
 *
 * The audit found 11 real consumers of this one component (DeleteButton,
 * RemoveMemberButton, CancelInvitationButton, TransferOwnershipButton,
 * LeaveOrganizationButton, PortalInvitationActions x2,
 * InvoiceIssueControls, InvoiceLegacyArchiveControls,
 * InvoiceSendControls, InvoiceLifecycleControls) — and that across the
 * entire existing E2E suite, not one test ever clicks the dialog's own
 * Cancel control: every existing test that reaches a ConfirmDialog goes
 * straight to Confirm. Cancellation, dialog-content assertions, and
 * cross-fixture isolation were completely unexercised.
 *
 * Two representative flows are covered here, chosen for a genuine
 * implementation difference in what happens around the shared dialog,
 * not an arbitrary sample:
 *
 *  - Client delete (DeleteButton) — `useState` + try/catch + toast, the
 *    most-reused wrapper (identical code also backs Tasks, Projects,
 *    DRAFT Invoices, comments, and attachments — only the caller-supplied
 *    title/description/action differ, so this one wrapper's behavior
 *    transitively covers all of them).
 *  - Invoice cancel (InvoiceLifecycleControls) — `useTransition` +
 *    structured `{ ok, error }` result, proving the same dialog contract
 *    holds under a materially different async/render-timing pattern.
 *    invoices.spec.ts already covers this flow's *confirm* path; this
 *    file adds the missing cancel-dialog-button, dialog-content, and
 *    isolation coverage without touching that already-passing file.
 *
 * Every fixture here is created and torn down inside its own test — none
 * of the shared seeded owner/admin/member/client/invoice rows are
 * mutated, so this file cannot destabilize any other spec file's shared
 * state.
 */

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("ConfirmDialog — Client delete (DeleteButton, useState/try-catch/toast pattern)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  });

  test("opens with the real title/description naming the exact client, cancels without any mutation, then confirms exactly once and persists — leaving an unrelated client untouched", async ({
    page,
  }) => {
    const clientName = `E2E Confirm Dialog Client ${fixtures.runId}`;
    const target = await dbQuery<{ id: string }>("client", "create", {
      data: { name: clientName, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    // The isolation control: a second, unrelated disposable client that
    // must still exist, unmodified, after both the cancel and the real
    // confirm below.
    const controlName = `E2E Confirm Dialog Control ${fixtures.runId}`;
    const control = await dbQuery<{ id: string }>("client", "create", {
      data: { name: controlName, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });

    try {
      await page.goto("/clients");
      const row = page.getByRole("row", { name: new RegExp(clientName) });
      await expect(row).toBeVisible();

      // A. Dialog opening — real trigger, real accessible dialog, bounded
      // content naming this exact client, both controls present.
      await row.getByRole("button", { name: "Delete" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Delete client" })).toBeVisible();
      await expect(dialog.getByText(`Delete ${clientName}? This action cannot be undone.`)).toBeVisible();
      // Bounded: the dialog's own text never mentions the unrelated
      // control client.
      await expect(dialog.getByText(controlName)).toHaveCount(0);
      const cancelControl = dialog.getByRole("button", { name: "Cancel" });
      const confirmControl = dialog.getByRole("button", { name: "Delete" });
      await expect(cancelControl).toBeVisible();
      await expect(cancelControl).toBeEnabled();
      await expect(confirmControl).toBeVisible();
      await expect(confirmControl).toBeEnabled();

      // B. Cancellation — no request is ever sent; the dialog closing is
      // itself the only expected effect.
      await cancelControl.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("Client deleted")).toHaveCount(0);
      await expect(row).toBeVisible();

      // Persistence proof: a real reload, not just absence of a client-
      // side error, confirms Cancel performed no server mutation at all.
      await page.reload();
      await expect(page.getByRole("row", { name: new RegExp(clientName) })).toBeVisible();
      const afterCancel = await dbQuery("client", "findUnique", { where: { id: target.id } });
      expect(afterCancel).not.toBeNull();

      // C. Confirmation — reopen the same dialog and this time confirm.
      // Cancel could not have accidentally submitted the mutation above:
      // the record above is still proven present before this step even
      // begins.
      await page.getByRole("row", { name: new RegExp(clientName) }).getByRole("button", { name: "Delete" }).click();
      const reopenedDialog = page.getByRole("dialog");
      await expect(reopenedDialog).toBeVisible();
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST"),
        reopenedDialog.getByRole("button", { name: "Delete" }).click(),
      ]);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("Client deleted")).toBeVisible();

      // Persistence proof for the real mutation, and exactly-once proof:
      // a hard reload plus a real DB read, not merely the toast.
      await page.reload();
      await expect(page.getByRole("row", { name: new RegExp(`^${clientName}$`) })).toHaveCount(0);
      const afterConfirm = await dbQuery("client", "findUnique", { where: { id: target.id } });
      expect(afterConfirm).toBeNull();

      // D. Isolation — the unrelated control client was never touched by
      // either the cancel or the confirm above.
      const controlRow = page.getByRole("row", { name: new RegExp(controlName) });
      await expect(controlRow).toBeVisible();
      const controlAfter = await dbQuery("client", "findUnique", { where: { id: control.id } });
      expect(controlAfter).not.toBeNull();
    } finally {
      await dbQuery("client", "deleteMany", { where: { id: { in: [target.id, control.id] } } });
    }
  });
});

test.describe("ConfirmDialog — Invoice cancel (InvoiceLifecycleControls, useTransition/structured-result pattern)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  });

  test("opens with the real title/description naming the exact invoice, cancels without any mutation, then confirms exactly once and persists — leaving an unrelated invoice untouched", async ({
    page,
  }) => {
    const invoiceNumber = `E2E-CONFIRM-DIALOG-CANCEL-${fixtures.runId}`;
    const target = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber,
        status: "SENT",
        amount: "125.00",
        subtotal: "125.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        projectId: fixtures.project.id,
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
      },
    });
    // The isolation control: a second, unrelated disposable SENT invoice
    // that must still be SENT, unmodified, after both the cancel and the
    // real confirm below.
    const controlNumber = `E2E-CONFIRM-DIALOG-CONTROL-${fixtures.runId}`;
    const control = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber: controlNumber,
        status: "SENT",
        amount: "50.00",
        subtotal: "50.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        projectId: fixtures.project.id,
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
      },
    });

    try {
      await page.goto(`/invoices/${target.id}/edit`);

      // A. Dialog opening.
      await page.getByRole("button", { name: "Cancel invoice" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Cancel invoice" })).toBeVisible();
      await expect(dialog.getByText(`Cancel invoice ${invoiceNumber}? This cannot be undone.`)).toBeVisible();
      await expect(dialog.getByText(controlNumber)).toHaveCount(0);
      // exact: true — "Cancel" is otherwise a substring match of the
      // confirm button's own "Cancel invoice" label (a coincidence of
      // this specific consumer's business terminology, not true of the
      // Client delete flow above).
      const cancelControl = dialog.getByRole("button", { name: "Cancel", exact: true });
      const confirmControl = dialog.getByRole("button", { name: "Cancel invoice" });
      await expect(cancelControl).toBeVisible();
      await expect(cancelControl).toBeEnabled();
      await expect(confirmControl).toBeVisible();
      await expect(confirmControl).toBeEnabled();

      // B. Cancellation of the dialog itself — not to be confused with
      // the invoice's own "Cancel invoice" business action. Dismissing
      // the dialog must perform none of it.
      await cancelControl.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("Invoice updated")).toHaveCount(0);
      // Still SENT — the lifecycle buttons for a live invoice are still
      // present; a Cancelled invoice would show none of them.
      await expect(page.getByRole("button", { name: "Mark as paid" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel invoice" })).toBeVisible();

      await page.reload();
      await expect(page.getByRole("button", { name: "Mark as paid" })).toBeVisible();
      const afterCancel = await dbQuery<{ status: string }>("invoice", "findUniqueOrThrow", {
        where: { id: target.id },
      });
      expect(afterCancel.status).toBe("SENT");

      // C. Confirmation — reopen and this time really confirm. The
      // status read above already proves Cancel could not have
      // accidentally performed this transition.
      await page.getByRole("button", { name: "Cancel invoice" }).click();
      const reopenedDialog = page.getByRole("dialog");
      await expect(reopenedDialog).toBeVisible();
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST"),
        reopenedDialog.getByRole("button", { name: "Cancel invoice" }).click(),
      ]);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("Invoice updated")).toBeVisible();

      await page.reload();
      await expect(page.getByText("Cancelled")).toBeVisible();
      await expect(page.getByRole("button", { name: "Mark as paid" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cancel invoice" })).toHaveCount(0);
      const afterConfirm = await dbQuery<{ status: string }>("invoice", "findUniqueOrThrow", {
        where: { id: target.id },
      });
      expect(afterConfirm.status).toBe("CANCELLED");

      // D. Isolation — the unrelated control invoice was never touched.
      const controlAfter = await dbQuery<{ status: string }>("invoice", "findUniqueOrThrow", {
        where: { id: control.id },
      });
      expect(controlAfter.status).toBe("SENT");
    } finally {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: [target.id, control.id] } } });
    }
  });
});

/**
 * Aqenra Phase 3.1 — regression coverage for the native <dialog>
 * centering fix (src/components/ui/dialog-classes.ts): a Tailwind
 * preflight `margin: 0` reset was silently overriding the browser's own
 * `dialog:modal` centering, pinning every dialog to the viewport's
 * top-left corner instead. Asserts the dialog's own bounding-box center
 * lands close to the viewport's center — a generous tolerance, not an
 * exact-pixel screenshot comparison, so this stays robust to minor
 * future padding/shadow tweaks while still failing hard if the fix ever
 * regresses (a top-left-pinned dialog would be off by hundreds of
 * pixels, not a handful).
 */
async function expectDialogCentered(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("expectDialogCentered requires a real viewport size");
  const box = await page.getByRole("dialog").boundingBox();
  if (!box) throw new Error("dialog has no bounding box — is it actually open/visible?");
  const dialogCenterX = box.x + box.width / 2;
  const dialogCenterY = box.y + box.height / 2;
  expect(Math.abs(dialogCenterX - viewport.width / 2)).toBeLessThan(viewport.width * 0.15);
  expect(Math.abs(dialogCenterY - viewport.height / 2)).toBeLessThan(viewport.height * 0.15);
}

test.describe("Dialog centering (Phase 3.1) — ConfirmDialog and MarkLeadLostDialog render centered, not pinned to the top-left", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  });

  test("the shared ConfirmDialog (Client delete) renders centered at desktop and mobile widths", async ({ page }) => {
    const clientName = `E2E Confirm Centering ${fixtures.runId}`;
    const target = await dbQuery<{ id: string }>("client", "create", {
      data: { name: clientName, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    try {
      await page.goto("/clients");
      // Scoped to "tr, li" (TableRow / RecordCard, see record-list.tsx)
      // rather than getByRole("row"): only the desktop <table> row
      // actually has an ARIA row role — the mobile RecordCardList's own
      // <li> cards (the only ones visible below the xl breakpoint) do
      // not, so a role-based lookup would find nothing once the
      // viewport is resized below.
      await page.locator("tr, li").filter({ hasText: clientName }).getByRole("button", { name: "Delete" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectDialogCentered(page);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page.locator("tr, li").filter({ hasText: clientName }).getByRole("button", { name: "Delete" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectDialogCentered(page);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    } finally {
      await dbQuery("client", "deleteMany", { where: { id: target.id } });
    }
  });

  test("the non-shared MarkLeadLostDialog renders centered at desktop and mobile widths", async ({ page }) => {
    const leadName = `E2E Confirm Centering Lead ${fixtures.runId}`;
    const lead = await dbQuery<{ id: string }>("lead", "create", {
      data: { name: leadName, organizationId: fixtures.orgA.id },
    });
    try {
      await page.goto(`/leads/${lead.id}/edit`);
      await page.getByRole("button", { name: "Mark lost" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectDialogCentered(page);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page.getByRole("button", { name: "Mark lost" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectDialogCentered(page);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    } finally {
      await dbQuery("lead", "deleteMany", { where: { id: lead.id } });
    }
  });
});
