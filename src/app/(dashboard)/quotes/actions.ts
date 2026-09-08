"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { checkRateLimit, QUOTE_CREATE_LIMIT, QUOTE_UPDATE_LIMIT } from "@/lib/rate-limit";
import { createActivity } from "@/lib/activity/create-activity";
import { diffQuoteFields, buildQuoteActivityMetadata, buildQuoteStatusChangeMetadata } from "@/lib/activity/quote-metadata";
import {
  parseQuoteInput,
  hasQuoteFormErrors,
  mapQuoteCalculationError,
  type QuoteFieldErrors,
  type QuoteItemErrors,
  type QuoteWritableInput,
} from "@/lib/validation/quote";
import { calculateQuoteTotals } from "@/lib/quotes/calculations";
import { resolveQuoteTarget } from "@/lib/quotes/target";
import { mapQuoteWriteError } from "@/lib/quotes/write-conflict-mapper";
import { isQuoteConverted, isQuoteExpired } from "@/lib/quotes/status";

/**
 * Quotes / Estimates Phase 2. No Quote UI exists yet (a later phase) —
 * every action here takes plain, already-typed arguments rather than
 * FormData, and every result is a discriminated union rather than a
 * redirect/toast, mirroring Leads Phase 2's own exact architecture
 * (src/app/(dashboard)/leads/actions.ts's own header comment) so a future
 * form layer can adopt whichever shape it needs without this module
 * changing.
 *
 * Every action below follows the same architecture this app already uses
 * for Client/Project/Task/Invoice/Lead mutations: resolve
 * {user, organizationId} via getCurrentUserOrganization() first (never
 * accept organizationId as input), rate-limit keyed by the resolved
 * user.id, verify any foreign-key input (leadId/clientId) actually
 * belongs to this same organization, do the write inside
 * prisma.$transaction alongside its Activity row, scope every lookup and
 * write by {id, organizationId} together so a foreign-org id is
 * indistinguishable from a nonexistent one, and revalidatePath("/quotes")
 * even though nothing renders there yet — matching every Lead action's
 * own identical precedent.
 *
 * Quote -> Invoice conversion (convertQuoteToInvoiceAction) is
 * intentionally NOT implemented in this phase — see this phase's own
 * return report: Invoice.projectId is a required (non-nullable) column,
 * and a Quote has no Project concept at all. Implementing conversion
 * would require either a schema change (out of this phase's scope,
 * "unless a genuine blocker is discovered" — this is exactly that
 * blocker) or silently auto-creating a Project, which this phase's own
 * instructions explicitly forbid. This module still centralizes every
 * lifecycle helper (isQuoteExpired/isQuoteConverted/isQuoteEditable/
 * isQuoteApprovable in src/lib/quotes/status.ts) so a later phase that
 * resolves the Project question can implement conversion, Portal
 * approve/decline, etc. without this module changing.
 */

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateQuoteResult =
  | { ok: true; quoteId: string }
  | { ok: false; reason: "validation"; fieldErrors: QuoteFieldErrors; itemErrors?: QuoteItemErrors }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "invalid_target" }
  | { ok: false; reason: "duplicate_quote_number" };

/**
 * Always creates at stage DRAFT — no explicit initial-status input is
 * accepted (mirrors createLeadAction's own "always NEW" discipline).
 * sentAt/approvedAt/declinedAt/recipientName/recipientEmail/
 * convertedInvoiceId/archivedAt are never set here — each is either
 * always null at creation or only ever set by its own dedicated
 * lifecycle action.
 */
export async function createQuoteAction(input: QuoteWritableInput): Promise<CreateQuoteResult> {
  const { values, fieldErrors, itemErrors } = parseQuoteInput(input);
  if (hasQuoteFormErrors(fieldErrors, itemErrors) || !values.target) {
    return { ok: false, reason: "validation", fieldErrors, itemErrors };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(QUOTE_CREATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const targetResult = await resolveQuoteTarget(prisma, organizationId, values.target);
  if (!targetResult.ok) {
    return { ok: false, reason: "invalid_target" };
  }

  const calc = calculateQuoteTotals({
    subtotalSource: { mode: "lineItems", lineItems: values.items },
    discount: values.discountType === "NONE" ? { type: "NONE" } : { type: values.discountType, value: values.discountValue ?? "" },
    taxRatePercent: values.taxRatePercent,
  });
  if (!calc.ok) {
    const mapped = mapQuoteCalculationError(calc.error);
    return { ok: false, reason: "validation", fieldErrors: mapped.fieldErrors ?? {}, itemErrors: mapped.itemErrors };
  }

  try {
    const quote = await prisma.$transaction(async (tx) => {
      const created = await tx.quote.create({
        data: {
          organizationId,
          number: values.number,
          status: "DRAFT",
          title: values.title,
          leadId: targetResult.target.leadId,
          clientId: targetResult.target.clientId,
          issueDate: values.issueDate,
          validUntil: values.validUntil,
          subtotal: calc.subtotal,
          discountAmount: calc.discountAmount,
          taxAmount: calc.taxAmount,
          total: calc.total,
          discountType: values.discountType,
          discountValue: values.discountType === "NONE" ? null : values.discountValue,
          taxRatePercent: values.taxRatePercent,
          taxLabel: values.taxLabel,
          currency: values.currency,
          notes: values.notes,
          createdByUserId: user.id,
          items: {
            create: calc.lineItems.map((item, index) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              position: index,
            })),
          },
        },
      });

      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "QUOTE",
        entityId: created.id,
        action: "CREATED",
        metadata: buildQuoteActivityMetadata(created, user.name),
      });

      return created;
    });

    revalidatePath("/quotes");
    return { ok: true, quoteId: quote.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && mapQuoteWriteError(err) === "QUOTE_NUMBER_CONFLICT") {
      return { ok: false, reason: "duplicate_quote_number" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Update (generic edit — never status/sentAt/approvedAt/declinedAt/
// recipient snapshot/convertedInvoiceId/createdByUserId/archivedAt,
// except the one documented SENT -> DRAFT reset below)
// ---------------------------------------------------------------------------

export type UpdateQuoteResult =
  | { ok: true }
  | { ok: false; reason: "validation"; fieldErrors: QuoteFieldErrors; itemErrors?: QuoteItemErrors }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_target" }
  | { ok: false; reason: "immutable" }
  | { ok: false; reason: "duplicate_quote_number" };

/**
 * DRAFT: freely editable. SENT (including derived-expired SENT): editing
 * is allowed, but atomically resets the Quote to DRAFT (clearing sentAt/
 * recipientName/recipientEmail) — editing a document a client has already
 * seen un-issues it, mirroring Invoice's own DRAFT<->SENT "Issue"
 * boundary in spirit. APPROVED: immutable, rejected outright (financial
 * content a client already accepted must never silently change).
 * DECLINED: cannot be edited directly — must go through
 * reopenQuoteAction first (this keeps "what did the client actually see
 * when they declined" unambiguous). A converted Quote (convertedInvoiceId
 * set) is likewise always rejected, regardless of its own stored status.
 *
 * Target changes are only permitted while the resulting Quote is DRAFT
 * (i.e. never on a SENT->stays-SENT path, which can't happen here since
 * any edit to a SENT quote already resets it to DRAFT first) and are
 * always revalidated inside this same transaction — never trusting the
 * parse-layer's format-only result.
 *
 * Line items: replace-all within the transaction (delete existing
 * QuoteItems, recreate normalized items with server-assigned contiguous
 * positions) — the safest MVP approach, matching this phase's own
 * explicit instruction; totals are always recalculated from the fresh
 * input, never merged with the prior persisted values.
 */
export async function updateQuoteAction(quoteId: string, input: QuoteWritableInput): Promise<UpdateQuoteResult> {
  const { values, fieldErrors, itemErrors } = parseQuoteInput(input);
  if (hasQuoteFormErrors(fieldErrors, itemErrors) || !values.target) {
    return { ok: false, reason: "validation", fieldErrors, itemErrors };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(QUOTE_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const calc = calculateQuoteTotals({
    subtotalSource: { mode: "lineItems", lineItems: values.items },
    discount: values.discountType === "NONE" ? { type: "NONE" } : { type: values.discountType, value: values.discountValue ?? "" },
    taxRatePercent: values.taxRatePercent,
  });
  if (!calc.ok) {
    const mapped = mapQuoteCalculationError(calc.error);
    return { ok: false, reason: "validation", fieldErrors: mapped.fieldErrors ?? {}, itemErrors: mapped.itemErrors };
  }

  const target = values.target;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.quote.findFirst({
        where: { id: quoteId, organizationId },
        include: { items: { orderBy: { position: "asc" } } },
      });
      if (!existing) {
        return "not_found" as const;
      }

      if (isQuoteConverted({ convertedInvoiceId: existing.convertedInvoiceId })) {
        return "immutable" as const;
      }
      if (existing.status === "APPROVED" || existing.status === "DECLINED") {
        return "immutable" as const;
      }

      const targetResult = await resolveQuoteTarget(tx, organizationId, target);
      if (!targetResult.ok) {
        return "invalid_target" as const;
      }

      const wasSent = existing.status === "SENT";

      const beforeSnapshot = {
        title: existing.title,
        leadId: existing.leadId,
        clientId: existing.clientId,
        issueDate: existing.issueDate,
        validUntil: existing.validUntil,
        currency: existing.currency,
        notes: existing.notes,
        discountType: existing.discountType,
        discountValue: existing.discountValue,
        taxRatePercent: existing.taxRatePercent,
        taxLabel: existing.taxLabel,
        items: existing.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
      };
      const afterSnapshot = {
        title: values.title,
        leadId: targetResult.target.leadId,
        clientId: targetResult.target.clientId,
        issueDate: values.issueDate,
        validUntil: values.validUntil,
        currency: values.currency,
        notes: values.notes,
        discountType: values.discountType,
        discountValue: values.discountType === "NONE" ? null : values.discountValue,
        taxRatePercent: values.taxRatePercent,
        taxLabel: values.taxLabel,
        items: calc.lineItems.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
      };
      const changedFields = diffQuoteFields(beforeSnapshot, afterSnapshot);

      // Replace-all: delete existing QuoteItems, recreate below with
      // fresh, contiguous, server-assigned positions — never trusted from
      // caller input.
      await tx.quoteItem.deleteMany({ where: { quoteId } });

      const result = await tx.quote.updateMany({
        where: { id: quoteId, organizationId },
        data: {
          number: values.number,
          title: values.title,
          leadId: targetResult.target.leadId,
          clientId: targetResult.target.clientId,
          issueDate: values.issueDate,
          validUntil: values.validUntil,
          subtotal: calc.subtotal,
          discountAmount: calc.discountAmount,
          taxAmount: calc.taxAmount,
          total: calc.total,
          discountType: values.discountType,
          discountValue: values.discountType === "NONE" ? null : values.discountValue,
          taxRatePercent: values.taxRatePercent,
          taxLabel: values.taxLabel,
          currency: values.currency,
          notes: values.notes,
          ...(wasSent ? { status: "DRAFT" as const, sentAt: null, recipientName: null, recipientEmail: null } : {}),
        },
      });

      if (result.count === 0) {
        return "not_found" as const;
      }

      await tx.quoteItem.createMany({
        data: calc.lineItems.map((item, index) => ({
          quoteId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          position: index,
        })),
      });

      // Content update and the SENT -> DRAFT lifecycle reset are recorded
      // as two separate, small Activity rows — matching this phase's own
      // "record both content update and status reset in the repo's
      // normal compact style" instruction (STATUS_CHANGED is always its
      // own event elsewhere in this app, e.g. Invoice's status-actions.ts;
      // an UPDATED event's own changedFields never lists "status").
      if (changedFields.length > 0) {
        await createActivity(tx, {
          organizationId,
          actorId: user.id,
          entityType: "QUOTE",
          entityId: quoteId,
          action: "UPDATED",
          metadata: buildQuoteActivityMetadata(
            { number: values.number, status: wasSent ? "DRAFT" : existing.status },
            user.name,
            changedFields,
          ),
        });
      }
      if (wasSent) {
        await createActivity(tx, {
          organizationId,
          actorId: user.id,
          entityType: "QUOTE",
          entityId: quoteId,
          action: "STATUS_CHANGED",
          metadata: buildQuoteStatusChangeMetadata("SENT", "DRAFT"),
        });
      }

      return "updated" as const;
    });

    if (outcome === "not_found") return { ok: false, reason: "not_found" };
    if (outcome === "immutable") return { ok: false, reason: "immutable" };
    if (outcome === "invalid_target") return { ok: false, reason: "invalid_target" };

    revalidatePath("/quotes");
    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && mapQuoteWriteError(err) === "QUOTE_NUMBER_CONFLICT") {
      return { ok: false, reason: "duplicate_quote_number" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Send (lifecycle transition to SENT only — never sends email)
// ---------------------------------------------------------------------------

export type SendQuoteResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_transition" };

/**
 * "Send" in this phase means the lifecycle transition to SENT — it never
 * calls Resend or generates a PDF (both explicitly out of this phase's
 * scope). Only a DRAFT, non-archived, non-converted Quote may be sent; a
 * `validUntil` already in the past is rejected (sending a document
 * that's already expired the moment it's issued is never a legitimate
 * transition).
 *
 * Recipient email is NOT required to send. Invoice's own closest analog —
 * Issue (DRAFT -> SENT, src/lib/invoices/pdf/issue-invoice.ts) — does not
 * require a recipient email either; Invoice's email requirement lives
 * entirely in its own separate, dedicated send-email action
 * (sendInvoiceEmailAction, which returns its own distinct
 * NO_RECIPIENT_EMAIL error code rather than blocking Issue itself). Since
 * this phase explicitly does not implement Quote email sending at all,
 * mirroring that same separation is the correct, minimal choice — a
 * later phase's own dedicated send-email action is exactly where an
 * email requirement belongs, not here.
 */
export async function sendQuoteAction(quoteId: string): Promise<SendQuoteResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(QUOTE_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.quote.findFirst({
      where: { id: quoteId, organizationId },
      include: {
        client: { select: { name: true, email: true } },
        lead: { select: { name: true, email: true } },
      },
    });
    if (!existing) {
      return "not_found" as const;
    }
    if (existing.archivedAt !== null) {
      return "invalid_transition" as const;
    }
    if (isQuoteConverted({ convertedInvoiceId: existing.convertedInvoiceId })) {
      return "invalid_transition" as const;
    }
    if (existing.status !== "DRAFT") {
      return "invalid_transition" as const;
    }
    if (existing.validUntil !== null && existing.validUntil.getTime() < Date.now()) {
      return "invalid_transition" as const;
    }

    // Recipient snapshot, never accepted from the caller — derived
    // server-side, Client taking priority over Lead when both are
    // present (an already-converted Lead's own Client is the current
    // identity; see src/lib/quotes/target.ts's own doc comment).
    const recipientName = existing.client?.name ?? existing.lead?.name ?? null;
    const recipientEmail = existing.client?.email ?? existing.lead?.email ?? null;

    const result = await tx.quote.updateMany({
      where: { id: quoteId, organizationId, status: "DRAFT" },
      data: {
        status: "SENT",
        sentAt: new Date(),
        recipientName,
        recipientEmail,
      },
    });
    if (result.count === 0) {
      return "invalid_transition" as const;
    }

    await createActivity(tx, {
      organizationId,
      actorId: user.id,
      entityType: "QUOTE",
      entityId: quoteId,
      action: "STATUS_CHANGED",
      metadata: buildQuoteStatusChangeMetadata("DRAFT", "SENT"),
    });

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  if (outcome === "invalid_transition") return { ok: false, reason: "invalid_transition" };

  revalidatePath("/quotes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reopen (DECLINED -> DRAFT, or derived-expired SENT -> DRAFT)
// ---------------------------------------------------------------------------

export type ReopenQuoteResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "immutable" }
  | { ok: false; reason: "invalid_transition" };

/**
 * The only two eligible starting states are DECLINED, and SENT that has
 * already expired (validUntil in the past) — a normal, still-open SENT
 * quote must never be reopened this way; editing it already resets it to
 * DRAFT (see updateQuoteAction's own SENT -> DRAFT branch), so a second,
 * overlapping "reopen" path for the same state would just be a redundant
 * way to reach the identical result. APPROVED can never reopen (a
 * genuinely terminal, accepted outcome). A converted Quote can never
 * reopen either, regardless of its own stored status. Never creates a
 * version/revision — this is a plain in-place lifecycle reset, exactly
 * like moveLeadStageAction's own "reactivation" (no separate reactivate
 * data model exists for Leads either).
 */
export async function reopenQuoteAction(quoteId: string): Promise<ReopenQuoteResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(QUOTE_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.quote.findFirst({ where: { id: quoteId, organizationId } });
    if (!existing) {
      return "not_found" as const;
    }
    if (isQuoteConverted({ convertedInvoiceId: existing.convertedInvoiceId })) {
      return "immutable" as const;
    }
    if (existing.status === "APPROVED") {
      return "invalid_transition" as const;
    }

    const eligible =
      existing.status === "DECLINED" ||
      (existing.status === "SENT" && isQuoteExpired({ status: existing.status, validUntil: existing.validUntil }));
    if (!eligible) {
      return "invalid_transition" as const;
    }

    const fromStatus = existing.status;

    const result = await tx.quote.updateMany({
      where: { id: quoteId, organizationId, convertedInvoiceId: null },
      data: {
        status: "DRAFT",
        sentAt: null,
        recipientName: null,
        recipientEmail: null,
        declinedAt: null,
      },
    });
    if (result.count === 0) {
      return "immutable" as const;
    }

    await createActivity(tx, {
      organizationId,
      actorId: user.id,
      entityType: "QUOTE",
      entityId: quoteId,
      action: "STATUS_CHANGED",
      metadata: buildQuoteStatusChangeMetadata(fromStatus, "DRAFT"),
    });

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  if (outcome === "immutable") return { ok: false, reason: "immutable" };
  if (outcome === "invalid_transition") return { ok: false, reason: "invalid_transition" };

  revalidatePath("/quotes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Archive / unarchive (soft only — no hard delete in this phase)
// ---------------------------------------------------------------------------

export type ArchiveQuoteResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" };

/**
 * Archive is visibility, not a mutation of business meaning — a
 * converted or APPROVED Quote may still be archived (no immutable/
 * converted check here, unlike status-changing actions), and archiving
 * never touches status, convertedInvoiceId, or any other field. Mirrors
 * archiveLeadAction/unarchiveLeadAction exactly, including idempotency
 * (archiving an already-archived Quote is a harmless no-op, not a new
 * Activity event).
 */
export async function archiveQuoteAction(quoteId: string): Promise<ArchiveQuoteResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(QUOTE_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.quote.findFirst({ where: { id: quoteId, organizationId } });
    if (!existing) {
      return "not_found" as const;
    }

    const alreadyArchived = existing.archivedAt !== null;

    const result = await tx.quote.updateMany({
      where: { id: quoteId, organizationId },
      data: { archivedAt: existing.archivedAt ?? new Date() },
    });
    if (result.count === 0) {
      return "not_found" as const;
    }

    if (!alreadyArchived) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "QUOTE",
        entityId: quoteId,
        action: "UPDATED",
        metadata: buildQuoteActivityMetadata({ number: existing.number, status: existing.status }, user.name, ["archivedAt"]),
      });
    }

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  revalidatePath("/quotes");
  return { ok: true };
}

export async function unarchiveQuoteAction(quoteId: string): Promise<ArchiveQuoteResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(QUOTE_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.quote.findFirst({ where: { id: quoteId, organizationId } });
    if (!existing) {
      return "not_found" as const;
    }

    const wasArchived = existing.archivedAt !== null;

    const result = await tx.quote.updateMany({
      where: { id: quoteId, organizationId },
      data: { archivedAt: null },
    });
    if (result.count === 0) {
      return "not_found" as const;
    }

    if (wasArchived) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "QUOTE",
        entityId: quoteId,
        action: "UPDATED",
        metadata: buildQuoteActivityMetadata({ number: existing.number, status: existing.status }, user.name, ["archivedAt"]),
      });
    }

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  revalidatePath("/quotes");
  return { ok: true };
}
