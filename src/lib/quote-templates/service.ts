import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { canManageQuoteTemplates, type QuoteTemplateActor } from "./authorization";
import {
  parseQuoteTemplateInput,
  hasQuoteTemplateFormErrors,
  mapQuoteTemplateCalculationError,
  QUOTE_TEMPLATE_NAME_MAX_LENGTH,
  type QuoteTemplateWritableInput,
  type QuoteTemplateFieldErrors,
  type QuoteTemplateItemErrors,
} from "./validation";
import { calculateQuoteTotals } from "@/lib/quotes/calculations";
import { getQuoteTemplateForManagement, type QuoteTemplateWithItems } from "./queries";
import type { PrismaClientOrTx } from "./types";

/**
 * Quote Templates Phase 1 — management mutations (create/update/archive/
 * restore/duplicate). Every function here follows this app's own
 * established domain-module shape exactly (src/lib/tags/definitions.ts's
 * own precedent): authorization checked first, before any DB read; every
 * lookup/write scoped by (id, organizationId) together; archive/restore
 * are idempotent no-ops on a redundant call; a discriminated-union result
 * instead of a thrown error for every *expected* outcome (FORBIDDEN,
 * NOT_FOUND, VALIDATION).
 *
 * organizationId and `actor` are always caller-supplied, already resolved
 * server-side from the current session (never accepted as raw input by
 * this module itself) — matching every other domain module in this app.
 * No Server Action wraps these yet (Phase 2); a future one calls these
 * functions directly, resolving {organizationId, membership} via
 * getCurrentMembership() exactly like every other privileged Settings
 * mutation in this app already does.
 *
 * Snapshot semantics: nothing in this file ever writes to a Quote or
 * QuoteItem row, and nothing in the Quote domain ever reads from
 * QuoteTemplate — the two are fully decoupled by construction (see
 * QuoteTemplate's own schema doc comment). No Activity row is written by
 * any function here (see the architecture audit's own §21 — deferred,
 * not required for V1) and no Workflow Automation event is ever
 * triggered (management/application of a template creates no Quote at
 * all, and createActivity() is never called here in the first place).
 */

function normalizeItemsForStorage(
  items: { description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }[],
): { description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; position: number }[] {
  return items.map((item, position) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, position }));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateQuoteTemplateResult =
  | { ok: true; template: QuoteTemplateWithItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: QuoteTemplateFieldErrors; itemErrors?: QuoteTemplateItemErrors };

export async function createQuoteTemplate(
  organizationId: string,
  actor: QuoteTemplateActor,
  input: QuoteTemplateWritableInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateQuoteTemplateResult> {
  if (!(await canManageQuoteTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const parsed = parseQuoteTemplateInput(input);
  if (hasQuoteTemplateFormErrors(parsed.fieldErrors, parsed.itemErrors)) {
    return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors, itemErrors: parsed.itemErrors };
  }

  // The same real numeric/business-rule validation ordinary Quote
  // creation runs -- never a separate, potentially-diverging tax/discount
  // engine (see this module's own header comment). The computed
  // subtotal/discountAmount/taxAmount/total are used ONLY to validate and
  // to read back exact, normalized Decimal line-item values for storage
  // -- none of the four are themselves persisted onto QuoteTemplate (see
  // its own schema comment for why).
  const totals = calculateQuoteTotals({
    subtotalSource: { mode: "lineItems", lineItems: parsed.values.items },
    discount:
      parsed.values.discountType === "NONE"
        ? { type: "NONE" }
        : { type: parsed.values.discountType, value: parsed.values.discountValue as string },
    taxRatePercent: parsed.values.taxRatePercent,
  });
  if (!totals.ok) {
    const mapped = mapQuoteTemplateCalculationError(totals.error);
    return { ok: false, reason: "VALIDATION", fieldErrors: mapped.fieldErrors ?? {}, itemErrors: mapped.itemErrors };
  }

  const template = await client.quoteTemplate.create({
    data: {
      organizationId,
      name: parsed.values.name,
      title: parsed.values.title,
      notes: parsed.values.notes,
      currency: parsed.values.currency,
      discountType: parsed.values.discountType,
      discountValue: parsed.values.discountValue,
      taxRatePercent: parsed.values.taxRatePercent,
      taxLabel: parsed.values.taxLabel,
      validityDays: parsed.values.validityDays,
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

export type UpdateQuoteTemplateResult =
  | { ok: true; template: QuoteTemplateWithItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: QuoteTemplateFieldErrors; itemErrors?: QuoteTemplateItemErrors };

/**
 * Whole-record update: every writable field is replaced, including items
 * (deleteMany the existing set, then createMany the new one, inside one
 * transaction) -- a deterministic "replace all children" shape with no
 * possibility of an orphaned child row, matching the same pattern this
 * app's own Invoice/Quote line-item edit paths already use for "the whole
 * item list changed." Archived state is untouched by this function --
 * updating the content of an archived template is allowed (it doesn't
 * become applyable by being edited; only restoreQuoteTemplate flips that).
 */
export async function updateQuoteTemplate(
  organizationId: string,
  templateId: string,
  actor: QuoteTemplateActor,
  input: QuoteTemplateWritableInput,
): Promise<UpdateQuoteTemplateResult> {
  if (!(await canManageQuoteTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getQuoteTemplateForManagement(organizationId, templateId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const parsed = parseQuoteTemplateInput(input);
  if (hasQuoteTemplateFormErrors(parsed.fieldErrors, parsed.itemErrors)) {
    return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors, itemErrors: parsed.itemErrors };
  }

  const totals = calculateQuoteTotals({
    subtotalSource: { mode: "lineItems", lineItems: parsed.values.items },
    discount:
      parsed.values.discountType === "NONE"
        ? { type: "NONE" }
        : { type: parsed.values.discountType, value: parsed.values.discountValue as string },
    taxRatePercent: parsed.values.taxRatePercent,
  });
  if (!totals.ok) {
    const mapped = mapQuoteTemplateCalculationError(totals.error);
    return { ok: false, reason: "VALIDATION", fieldErrors: mapped.fieldErrors ?? {}, itemErrors: mapped.itemErrors };
  }

  const template = await prisma.$transaction(async (tx) => {
    await tx.quoteTemplateItem.deleteMany({ where: { quoteTemplateId: templateId } });
    return tx.quoteTemplate.update({
      where: { id: templateId },
      data: {
        name: parsed.values.name,
        title: parsed.values.title,
        notes: parsed.values.notes,
        currency: parsed.values.currency,
        discountType: parsed.values.discountType,
        discountValue: parsed.values.discountValue,
        taxRatePercent: parsed.values.taxRatePercent,
        taxLabel: parsed.values.taxLabel,
        validityDays: parsed.values.validityDays,
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

export type ArchiveQuoteTemplateResult =
  | { ok: true; template: QuoteTemplateWithItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" };

export async function archiveQuoteTemplate(
  organizationId: string,
  templateId: string,
  actor: QuoteTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<ArchiveQuoteTemplateResult> {
  if (!(await canManageQuoteTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getQuoteTemplateForManagement(organizationId, templateId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    // Idempotent no-op -- already archived, same convention
    // archiveTag/archiveCustomFieldDefinition already use for a redundant
    // call.
    return { ok: true, template: existing };
  }

  const template = await client.quoteTemplate.update({
    where: { id: templateId },
    data: { archivedAt: new Date() },
    include: { items: { orderBy: { position: "asc" } } },
  });
  return { ok: true, template };
}

export type RestoreQuoteTemplateResult = ArchiveQuoteTemplateResult;

export async function restoreQuoteTemplate(
  organizationId: string,
  templateId: string,
  actor: QuoteTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<RestoreQuoteTemplateResult> {
  if (!(await canManageQuoteTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getQuoteTemplateForManagement(organizationId, templateId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    // Idempotent no-op -- already active.
    return { ok: true, template: existing };
  }

  const template = await client.quoteTemplate.update({
    where: { id: templateId },
    data: { archivedAt: null },
    include: { items: { orderBy: { position: "asc" } } },
  });
  return { ok: true, template };
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

export type DuplicateQuoteTemplateResult =
  | { ok: true; template: QuoteTemplateWithItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" };

/**
 * Duplicates a template (any state, active or archived) into a brand-new,
 * always-ACTIVE template with brand-new ids for both the parent row and
 * every item -- never copies `archivedAt` as archived, regardless of the
 * source's own state (see the approved Phase 1 spec's own explicit
 * requirement). The current authenticated privileged actor becomes the
 * new row's own creator, independent of who created the source (audit
 * metadata only -- see QuoteTemplate's own schema comment). Name is a
 * simple, deterministic `"<original name> Copy"` -- no collision
 * numbering, since names are deliberately never required to be unique
 * (see validation.ts's own header comment).
 */
export async function duplicateQuoteTemplate(
  organizationId: string,
  templateId: string,
  actor: QuoteTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<DuplicateQuoteTemplateResult> {
  if (!(await canManageQuoteTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const source = await getQuoteTemplateForManagement(organizationId, templateId, client);
  if (!source) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  // Deliberately no collision-numbering loop (see this function's own
  // doc comment) -- the raw " Copy" suffix can itself push past
  // QUOTE_TEMPLATE_NAME_MAX_LENGTH for an already-long source name;
  // truncating the ORIGINAL portion (never silently dropping the "
  // Copy" suffix, which is what actually signals this is a duplicate)
  // keeps the result always valid without inventing a numbering scheme
  // the approved spec explicitly says isn't needed.
  const suffix = " Copy";
  const maxOriginalLength = QUOTE_TEMPLATE_NAME_MAX_LENGTH - suffix.length;
  const truncatedName = source.name.length > maxOriginalLength ? source.name.slice(0, maxOriginalLength) : source.name;
  const newName = `${truncatedName}${suffix}`;

  const template = await client.quoteTemplate.create({
    data: {
      organizationId,
      name: newName,
      title: source.title,
      notes: source.notes,
      currency: source.currency,
      discountType: source.discountType,
      discountValue: source.discountValue,
      taxRatePercent: source.taxRatePercent,
      taxLabel: source.taxLabel,
      validityDays: source.validityDays,
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
