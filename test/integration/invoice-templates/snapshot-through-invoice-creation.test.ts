import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createInvoiceTemplate, updateInvoiceTemplate } from "@/lib/invoice-templates/service";
import { getInvoiceTemplateDefaults } from "@/lib/invoice-templates/apply";
import { createInvoiceAction } from "@/app/(dashboard)/invoices/new/actions";
import { encodeInvoiceLineItemsFormValue } from "@/lib/invoices/line-items-form";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";
import { actorFor, templateInput } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");

/**
 * Invoice Templates V1 (the V1 invariant proven end to end, not just at
 * the apply.ts unit level): Template A -> "Start an invoice from it"
 * (getInvoiceTemplateDefaults, the exact function /invoices/new?templateId=<id>
 * calls) -> an ORDINARY, unmodified createInvoiceAction call (the exact
 * same Server Action a hand-typed Invoice uses) -> a real, persisted
 * Invoice row. Editing Template A afterward must leave that already-
 * created Invoice completely untouched — proving there is no hidden
 * Template -> Invoice relationship, not merely that apply.ts's own
 * returned object happens to be a disconnected copy (already proven at
 * the unit level in apply.test.ts's own "snapshot semantics" describe
 * block). Mirrors
 * test/integration/quote-templates/snapshot-through-quote-creation.test.ts's
 * own identical shape exactly, adapted for createInvoiceAction's own
 * FormData/useActionState signature (unlike createQuoteAction's plain-
 * object signature).
 *
 * Invoice.organizationId is onDelete: Restrict, so this test explicitly
 * deletes its own Invoice row before cleanupTestData() removes the
 * fixture Organization/Client/User rows it references.
 */
describe("Invoice Templates -> Invoice snapshot, proven through the real create path", () => {
  let fixtures: TestFixtures;
  let templateIds: string[] = [];
  let invoiceIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    if (invoiceIds.length > 0) {
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      invoiceIds = [];
    }
    if (templateIds.length > 0) {
      await prisma.invoiceTemplate.deleteMany({ where: { id: { in: templateIds } } });
      templateIds = [];
    }
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("editing the template after an Invoice was created from it never changes that Invoice's already-persisted values", async () => {
    const owner = actorFor(fixtures.owner, "OWNER");

    const created = await createInvoiceTemplate(
      fixtures.orgA.id,
      owner,
      templateInput({
        name: "Template A",
        notes: "Original client-facing notes",
        internalNotes: "Original internal notes",
        currency: "EUR",
        discountType: "PERCENTAGE",
        discountValue: "15",
        taxRatePercent: "19",
        taxLabel: "VAT",
        dueDateOffsetDays: "30",
        items: [
          { description: "Original item A", quantity: "1", unitPrice: "100.00" },
          { description: "Original item B", quantity: "2", unitPrice: "50.00" },
        ],
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    templateIds.push(created.template.id);

    // "Start an invoice from it" — the exact same, real, read-only apply
    // entry point /invoices/new?templateId=<id> calls.
    actAs(fixtures.owner, fixtures.orgA.id);
    const applyResult = await getInvoiceTemplateDefaults(created.template.id, NOW);
    expect(applyResult.ok).toBe(true);
    if (!applyResult.ok) return;
    const snapshot = applyResult.defaults;

    // An ordinary, completely unmodified Invoice-create call — the same
    // Server Action a hand-typed Invoice uses, fed with the snapshot's
    // own values plus the ordinary client/number/issueDate every Invoice
    // needs.
    const invoiceNumber = `SNAPSHOT-${randomUUID().slice(0, 8)}`;
    const formData = new FormData();
    formData.set("invoiceNumber", invoiceNumber);
    formData.set("clientId", fixtures.clientA.id);
    formData.set("projectId", "");
    formData.set("mode", "itemized");
    formData.set("amount", "");
    formData.set("lineItems", encodeInvoiceLineItemsFormValue(snapshot.items));
    formData.set("currency", snapshot.currency);
    formData.set("issueDate", "2026-06-15");
    formData.set("dueDate", snapshot.dueDate ?? "");
    formData.set("notes", snapshot.notes ?? "");
    formData.set("internalNotes", snapshot.internalNotes ?? "");
    formData.set("discountType", snapshot.discountType);
    formData.set("discountValue", snapshot.discountValue ?? "");
    formData.set("taxRatePercent", snapshot.taxRatePercent ?? "");
    formData.set("taxLabel", snapshot.taxLabel);

    let caught: unknown;
    try {
      await createInvoiceAction({ error: null }, formData);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);
    resetAuthMock();

    const originalInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { organizationId_invoiceNumber: { organizationId: fixtures.orgA.id, invoiceNumber } },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    invoiceIds.push(originalInvoice.id);

    expect(originalInvoice.notes).toBe("Original client-facing notes");
    expect(originalInvoice.internalNotes).toBe("Original internal notes");
    expect(originalInvoice.currency).toBe("EUR");
    expect(originalInvoice.discountType).toBe("PERCENTAGE");
    expect(originalInvoice.discountValue?.toString()).toBe("15");
    expect(originalInvoice.taxRatePercent?.toString()).toBe("19");
    expect(originalInvoice.taxLabel).toBe("VAT");
    expect(originalInvoice.dueDate?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(originalInvoice.lineItems.map((i) => i.description)).toEqual(["Original item A", "Original item B"]);

    // Now edit Template A to completely different content.
    const updated = await updateInvoiceTemplate(
      fixtures.orgA.id,
      created.template.id,
      owner,
      templateInput({
        name: "Template A (changed)",
        notes: "CHANGED notes",
        internalNotes: "CHANGED internal notes",
        currency: "USD",
        discountType: "FIXED",
        discountValue: "5.00",
        taxRatePercent: "0",
        taxLabel: "GST",
        dueDateOffsetDays: "7",
        items: [{ description: "CHANGED item", quantity: "9", unitPrice: "9.00" }],
      }),
    );
    expect(updated.ok).toBe(true);

    // The already-created Invoice is completely untouched — same row,
    // re-fetched fresh from the database, every field identical to what
    // was asserted above. This is the whole point: there is no
    // persistent Template -> Invoice relationship of any kind (the
    // Invoice model itself has no sourceTemplateId column at all — this
    // line would fail to compile, not merely fail an assertion, if one
    // were ever added and this test tried to use it) for an edit to
    // propagate through even if the domain layer wanted it to.
    const invoiceAfterTemplateEdit = await prisma.invoice.findUniqueOrThrow({
      where: { id: originalInvoice.id },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    expect(invoiceAfterTemplateEdit.notes).toBe("Original client-facing notes");
    expect(invoiceAfterTemplateEdit.internalNotes).toBe("Original internal notes");
    expect(invoiceAfterTemplateEdit.currency).toBe("EUR");
    expect(invoiceAfterTemplateEdit.discountType).toBe("PERCENTAGE");
    expect(invoiceAfterTemplateEdit.discountValue?.toString()).toBe("15");
    expect(invoiceAfterTemplateEdit.taxRatePercent?.toString()).toBe("19");
    expect(invoiceAfterTemplateEdit.taxLabel).toBe("VAT");
    expect(invoiceAfterTemplateEdit.lineItems.map((i) => i.description)).toEqual(["Original item A", "Original item B"]);
    expect(invoiceAfterTemplateEdit.updatedAt.getTime()).toBe(originalInvoice.updatedAt.getTime());
  });
});
