import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { canManageInvoiceTemplates, type InvoiceTemplateActor } from "./authorization";
import {
  parseInvoiceTemplateInput,
  hasInvoiceTemplateFormErrors,
  mapInvoiceTemplateCalculationError,
  INVOICE_TEMPLATE_NAME_MAX_LENGTH,
  type InvoiceTemplateWritableInput,
  type InvoiceTemplateFieldErrors,
  type InvoiceTemplateItemErrors,
} from "./validation";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { getInvoiceTemplateForManagement, type InvoiceTemplateWithItems } from "./queries";
import type { PrismaClientOrTx } from "./types";

/**
 * Invoice Templates V1 — management mutations (create/update/archive/
 * restore/duplicate). Mirrors src/lib/quote-templates/service.ts's own
 * established domain-module shape exactly: authorization checked first,
 * before any DB read; every lookup/write scoped by (id, organizationId)
 * together; archive/restore are idempotent no-ops on a redundant call; a
 * discriminated-union result instead of a thrown error for every
 * *expected* outcome (FORBIDDEN, NOT_FOUND, VALIDATION).
 *
 * organizationId and `actor` are always caller-supplied, already resolved
 * server-side from the current session (never accepted as raw input by
 * this module itself) — matching every other domain module in this app.
 *
 * Snapshot semantics: nothing in this file ever writes to an Invoice or
 * InvoiceLineItem row, and nothing in the Invoice domain ever reads from
 * InvoiceTemplate — the two are fully decoupled by construction (see
 * InvoiceTemplate's own schema doc comment). No Activity row is written
 * by any function here (matching QuoteTemplate's own precedent — deferred,
 * not required for V1) and no Workflow Automation event is ever triggered
 * (management/application of a template creates no Invoice at all).
 */

function normalizeItemsForStorage(
  items: { description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }[],
): { description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; position: number }[] {
  return items.map((item, position) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, position }));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateInvoiceTemplateResult =
  | { ok: true; template: InvoiceTemplateWithItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: InvoiceTemplateFieldErrors; itemErrors?: InvoiceTemplateItemErrors };

export async function createInvoiceTemplate(
  organizationId: string,
  actor: InvoiceTemplateActor,
  input: InvoiceTemplateWritableInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateInvoiceTemplateResult> {
  if (!(await canManageInvoiceTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const parsed = parseInvoiceTemplateInput(input);
  if (hasInvoiceTemplateFormErrors(parsed.fieldErrors, parsed.itemErrors)) {
    return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors, itemErrors: parsed.itemErrors };
  }

  // The same real numeric/business-rule validation ordinary Invoice
  // creation runs -- never a separate, potentially-diverging tax/discount
  // engine. The computed subtotal/discountAmount/taxAmount/total are used
  // ONLY to validate and to read back exact, normalized Decimal line-item
  // values for storage -- none of the four are themselves persisted onto
  // InvoiceTemplate (see its own schema comment for why).
  const totals = calculateInvoiceTotals({
    subtotalSource: { mode: "lineItems", lineItems: parsed.values.items },
    discount:
      parsed.values.discountType === "NONE"
        ? { type: "NONE" }
        : { type: parsed.values.discountType, value: parsed.values.discountValue as string },
    taxRatePercent: parsed.values.taxRatePercent,
  });
  if (!totals.ok) {
    const mapped = mapInvoiceTemplateCalculationError(totals.error);
    return { ok: false, reason: "VALIDATION", fieldErrors: mapped.fieldErrors ?? {}, itemErrors: mapped.itemErrors };
  }

  const template = await client.invoiceTemplate.create({
    data: {
      organizationId,
      name: parsed.values.name,
      currency: parsed.values.currency,
      discountType: parsed.values.discountType,
      discountValue: parsed.values.discountValue,
      taxRatePercent: parsed.values.taxRatePercent,
      taxLabel: parsed.values.taxLabel,
      notes: parsed.values.notes,
      internalNotes: parsed.values.internalNotes,
      dueDateOffsetDays: parsed.values.dueDateOffsetDays,
      createdByUserId: actor.id,
      items: { create: normalizeItemsForStorage(totals.lineItems) },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
  return { ok: true, template };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateInvoiceTemplateResult =
  | { ok: true; template: InvoiceTemplateWithItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: InvoiceTemplateFieldErrors; itemErrors?: InvoiceTemplateItemErrors };

/**
 * Whole-record update: every writable field is replaced, including items
 * (deleteMany the existing set, then createMany the new one, inside one
 * transaction) -- a deterministic "replace all children" shape with no
 * possibility of an orphaned child row, matching
 * updateQuoteTemplate's own identical pattern. Archived state is
 * untouched by this function -- updating the content of an archived
 * template is allowed; only restoreInvoiceTemplate flips that.
 */
export async function updateInvoiceTemplate(
  organizationId: string,
  templateId: string,
  actor: InvoiceTemplateActor,
  input: InvoiceTemplateWritableInput,
): Promise<UpdateInvoiceTemplateResult> {
  if (!(await canManageInvoiceTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getInvoiceTemplateForManagement(organizationId, templateId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const parsed = parseInvoiceTemplateInput(input);
  if (hasInvoiceTemplateFormErrors(parsed.fieldErrors, parsed.itemErrors)) {
    return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors, itemErrors: parsed.itemErrors };
  }

  const totals = calculateInvoiceTotals({
    subtotalSource: { mode: "lineItems", lineItems: parsed.values.items },
    discount:
      parsed.values.discountType === "NONE"
        ? { type: "NONE" }
        : { type: parsed.values.discountType, value: parsed.values.discountValue as string },
    taxRatePercent: parsed.values.taxRatePercent,
  });
  if (!totals.ok) {
    const mapped = mapInvoiceTemplateCalculationError(totals.error);
    return { ok: false, reason: "VALIDATION", fieldErrors: mapped.fieldErrors ?? {}, itemErrors: mapped.itemErrors };
  }

  const template = await prisma.$transaction(async (tx) => {
    await tx.invoiceTemplateItem.deleteMany({ where: { invoiceTemplateId: templateId } });
    return tx.invoiceTemplate.update({
      where: { id: templateId },
      data: {
        name: parsed.values.name,
        currency: parsed.values.currency,
        discountType: parsed.values.discountType,
        discountValue: parsed.values.discountValue,
        taxRatePercent: parsed.values.taxRatePercent,
        taxLabel: parsed.values.taxLabel,
        notes: parsed.values.notes,
        internalNotes: parsed.values.internalNotes,
        dueDateOffsetDays: parsed.values.dueDateOffsetDays,
        items: { create: normalizeItemsForStorage(totals.lineItems) },
      },
      include: { items: { orderBy: { position: "asc" } } },
    });
  });
  return { ok: true, template };
}

// ---------------------------------------------------------------------------
// Archive / Restore
// ---------------------------------------------------------------------------

export type ArchiveInvoiceTemplateResult =
  | { ok: true; template: InvoiceTemplateWithItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" };

export async function archiveInvoiceTemplate(
  organizationId: string,
  templateId: string,
  actor: InvoiceTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<ArchiveInvoiceTemplateResult> {
  if (!(await canManageInvoiceTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getInvoiceTemplateForManagement(organizationId, templateId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    // Idempotent no-op -- already archived, same convention
    // archiveQuoteTemplate already uses for a redundant call.
    return { ok: true, template: existing };
  }

  const template = await client.invoiceTemplate.update({
    where: { id: templateId },
    data: { archivedAt: new Date() },
    include: { items: { orderBy: { position: "asc" } } },
  });
  return { ok: true, template };
}

export type RestoreInvoiceTemplateResult = ArchiveInvoiceTemplateResult;

export async function restoreInvoiceTemplate(
  organizationId: string,
  templateId: string,
  actor: InvoiceTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<RestoreInvoiceTemplateResult> {
  if (!(await canManageInvoiceTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getInvoiceTemplateForManagement(organizationId, templateId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    // Idempotent no-op -- already active.
    return { ok: true, template: existing };
  }

  const template = await client.invoiceTemplate.update({
    where: { id: templateId },
    data: { archivedAt: null },
    include: { items: { orderBy: { position: "asc" } } },
  });
  return { ok: true, template };
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

export type DuplicateInvoiceTemplateResult =
  | { ok: true; template: InvoiceTemplateWithItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" };

/**
 * Duplicates a template (any state, active or archived) into a brand-new,
 * always-ACTIVE template with brand-new ids for both the parent row and
 * every item -- never copies `archivedAt` as archived, regardless of the
 * source's own state. The current authenticated privileged actor becomes
 * the new row's own creator, independent of who created the source (audit
 * metadata only). Name is a simple, deterministic `"<original name>
 * Copy"` -- no collision numbering, since names are deliberately never
 * required to be unique. Mirrors duplicateQuoteTemplate exactly.
 */
export async function duplicateInvoiceTemplate(
  organizationId: string,
  templateId: string,
  actor: InvoiceTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<DuplicateInvoiceTemplateResult> {
  if (!(await canManageInvoiceTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const source = await getInvoiceTemplateForManagement(organizationId, templateId, client);
  if (!source) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  // Deliberately no collision-numbering loop (see this function's own
  // doc comment) -- the raw " Copy" suffix can itself push past
  // INVOICE_TEMPLATE_NAME_MAX_LENGTH for an already-long source name;
  // truncating the ORIGINAL portion (never silently dropping the "
  // Copy" suffix, which is what actually signals this is a duplicate)
  // keeps the result always valid.
  const suffix = " Copy";
  const maxOriginalLength = INVOICE_TEMPLATE_NAME_MAX_LENGTH - suffix.length;
  const truncatedName = source.name.length > maxOriginalLength ? source.name.slice(0, maxOriginalLength) : source.name;
  const newName = `${truncatedName}${suffix}`;

  const template = await client.invoiceTemplate.create({
    data: {
      organizationId,
      name: newName,
      currency: source.currency,
      discountType: source.discountType,
      discountValue: source.discountValue,
      taxRatePercent: source.taxRatePercent,
      taxLabel: source.taxLabel,
      notes: source.notes,
      internalNotes: source.internalNotes,
      dueDateOffsetDays: source.dueDateOffsetDays,
      createdByUserId: actor.id,
      archivedAt: null,
      items: {
        create: source.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          position: item.position,
        })),
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
  return { ok: true, template };
}
