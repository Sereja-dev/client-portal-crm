"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { checkRateLimit, QUOTE_CREATE_LIMIT, QUOTE_UPDATE_LIMIT } from "@/lib/rate-limit";
import { createActivity } from "@/lib/activity/create-activity";
import {
  diffQuoteFields,
  buildQuoteActivityMetadata,
  buildQuoteStatusChangeMetadata,
  buildQuoteConvertedMetadata,
} from "@/lib/activity/quote-metadata";
import { buildInvoiceSnapshotMetadata } from "@/lib/activity/invoice-metadata";
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
import { mapInvoiceWriteError } from "@/lib/invoices/write-conflict-mapper";
import { resolveInvoiceTarget } from "@/lib/invoices/target";
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
 * Quote -> Invoice conversion (convertQuoteToInvoiceAction, below) was
 * deliberately NOT implemented in Phase 2 (Invoice.projectId was still a
 * required column then). Quotes / Estimates Phase 2.3 resolved that
 * blocker — Invoice.projectId is now nullable and clientId-required/
 * projectId-optional is the durable Invoice invariant everywhere — so
 * conversion is implemented here using exactly that invariant: the new
 * Invoice's clientId always comes from Quote.clientId, projectId is
 * optional and independently re-verified (never derived, never
 * auto-created) via the same resolveInvoiceTarget() every manual Invoice
 * create/edit action already uses.
 */

/**
 * Thrown only when convertQuoteToInvoiceAction's own guarded
 * `convertedInvoiceId: null` Quote update matches zero rows — the
 * losing side of a genuine concurrent double-conversion race (a second
 * simultaneous call already won). Rolls the Invoice/InvoiceLineItem rows
 * this same attempt just created back with it. Never escapes this
 * module — mapped to the public "already_converted" reason.
 */
class QuoteConversionRaceError extends Error {}

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

// ---------------------------------------------------------------------------
// Convert to Invoice (APPROVED Quote -> a new DRAFT Invoice)
// ---------------------------------------------------------------------------

export type ConvertQuoteToInvoiceResult =
  | { ok: true; invoiceId: string }
  | { ok: false; reason: "validation"; fieldErrors: { invoiceNumber?: string } }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_converted" }
  | { ok: false; reason: "invalid_transition" }
  | { ok: false; reason: "no_client" }
  | { ok: false; reason: "invalid_target" }
  | { ok: false; reason: "duplicate_invoice_number" };

/**
 * Quotes / Estimates Phase 2.3 — the highest-risk new mutation this phase
 * adds. Input is deliberately narrow: `quoteId`, a user-supplied
 * `invoiceNumber` (Invoice numbering stays user-supplied everywhere in
 * this app — never auto-generated), and an OPTIONAL `projectId`. Never
 * `clientId`, `organizationId`, or `convertedInvoiceId` — the Client
 * always comes from the Quote itself (`quote.clientId`), organizationId
 * is always server-resolved, and convertedInvoiceId is only ever written
 * by the guarded update inside this same transaction, never accepted as
 * input.
 *
 * Eligibility (all re-verified from a FRESH read inside the transaction,
 * never trusting a stale pre-transaction read): the Quote must exist in
 * this organization, must not be archived, must have status APPROVED,
 * must not already be converted (convertedInvoiceId null), and must have
 * a real clientId (a Quote still only attached to an unconverted Lead —
 * clientId null — has no Client to invoice yet; converting it here would
 * either violate Invoice.clientId's own NOT NULL contract or require
 * silently inventing one, both of which are refused).
 *
 * Project is optional and, when supplied, re-verified via the exact same
 * resolveInvoiceTarget() every manual Invoice create/edit action already
 * uses — the Project must belong to this organization AND to this exact
 * Client (never auto-created, never silently substituted).
 *
 * Totals/discount/tax/currency are copied byte-for-byte from the Quote's
 * own already-approved, already-shown-to-the-client figures — never
 * recalculated, never re-derived from QuoteItems a second time (the
 * Quote's own total is the figure the client actually approved; silently
 * recomputing it here could theoretically drift from that if this
 * module's own calculation logic ever changed). QuoteItems are copied to
 * InvoiceLineItems the same way, by value, with fresh ids and the same
 * relative order.
 *
 * The guarded `convertedInvoiceId: null` predicate on the final Quote
 * updateMany is what makes concurrent double-conversion safe: exactly
 * one of two simultaneous callers can ever win it (the loser's `count`
 * is 0), and — because the Invoice create, the InvoiceLineItem creates,
 * and this guarded update all happen inside the ONE transaction started
 * below — a losing attempt's own freshly-created Invoice and line items
 * roll back with it, never left behind as an orphan.
 */
export async function convertQuoteToInvoiceAction(
  quoteId: string,
  invoiceNumberRaw: string,
  projectId?: string | null,
): Promise<ConvertQuoteToInvoiceResult> {
  const invoiceNumber = invoiceNumberRaw.trim();
  if (!invoiceNumber) {
    return { ok: false, reason: "validation", fieldErrors: { invoiceNumber: "Invoice number is required." } };
  }
  const targetProjectId = projectId ?? null;

  const { user, organizationId } = await getCurrentUserOrganization();

  // Shares the same bucket as every other Quote lifecycle mutation
  // (edit/send/reopen/archive) — a conversion is exactly that kind of
  // "one more small mutation against a resource already being worked
  // on" event, not a document-creation event like createQuoteAction's
  // own QUOTE_CREATE_LIMIT.
  const limitCheck = checkRateLimit(QUOTE_UPDATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, organizationId },
        include: { items: { orderBy: { position: "asc" } } },
      });
      if (!quote) {
        return { status: "not_found" as const };
      }
      if (quote.archivedAt !== null) {
        return { status: "invalid_transition" as const };
      }
      if (isQuoteConverted({ convertedInvoiceId: quote.convertedInvoiceId })) {
        return { status: "already_converted" as const };
      }
      if (quote.status !== "APPROVED") {
        return { status: "invalid_transition" as const };
      }
      if (quote.clientId === null) {
        return { status: "no_client" as const };
      }

      const targetResult = await resolveInvoiceTarget(tx, organizationId, {
        clientId: quote.clientId,
        projectId: targetProjectId,
      });
      if (!targetResult.ok) {
        return { status: "invalid_target" as const };
      }
      const { target } = targetResult;

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          status: "DRAFT",
          paidAt: null,
          dueDate: null,
          currency: quote.currency,
          // Copied exactly from the Quote's own already-approved
          // figures — never recalculated from QuoteItems a second time.
          amount: quote.total,
          subtotal: quote.subtotal,
          discountAmount: quote.discountAmount,
          taxAmount: quote.taxAmount,
          discountType: quote.discountType,
          discountValue: quote.discountValue,
          taxRatePercent: quote.taxRatePercent,
          taxLabel: quote.taxLabel,
          notes: quote.notes,
          clientId: target.clientId,
          projectId: target.projectId,
          organizationId,
          lineItems: {
            create: quote.items.map((item, index) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              position: index,
            })),
          },
        },
      });

      // The guard that makes concurrent double-conversion safe — see
      // this function's own header comment. Never `update()` (single-
      // record, no organizationId in its own filter) — always the
      // org-scoped, guarded `updateMany` form this codebase's own
      // security check requires for every Quote mutation.
      const guarded = await tx.quote.updateMany({
        where: { id: quoteId, organizationId, convertedInvoiceId: null },
        data: { convertedInvoiceId: invoice.id },
      });
      if (guarded.count !== 1) {
        throw new QuoteConversionRaceError();
      }

      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "QUOTE",
        entityId: quoteId,
        action: "CONVERTED",
        metadata: buildQuoteConvertedMetadata(quote, invoiceNumber, user.name),
      });

      // Same CREATED event a normal, direct createInvoiceAction call
      // always writes — a converted Invoice is otherwise indistinguishable
      // from a manually-created one in its own Activity history.
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "INVOICE",
        entityId: invoice.id,
        action: "CREATED",
        metadata: buildInvoiceSnapshotMetadata(invoice, quote.items.length, null, user.name),
      });

      return { status: "converted" as const, invoiceId: invoice.id };
    });

    if (outcome.status === "not_found") return { ok: false, reason: "not_found" };
    if (outcome.status === "already_converted") return { ok: false, reason: "already_converted" };
    if (outcome.status === "invalid_transition") return { ok: false, reason: "invalid_transition" };
    if (outcome.status === "no_client") return { ok: false, reason: "no_client" };
    if (outcome.status === "invalid_target") return { ok: false, reason: "invalid_target" };

    revalidatePath("/quotes");
    revalidatePath("/invoices");
    return { ok: true, invoiceId: outcome.invoiceId };
  } catch (err) {
    if (err instanceof QuoteConversionRaceError) {
      // The losing side of a concurrent double-conversion race — the
      // Invoice/InvoiceLineItem rows this same attempt just created roll
      // back with the throw, never left behind as an orphan.
      return { ok: false, reason: "already_converted" };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      if (mapInvoiceWriteError(err) === "INVOICE_NUMBER_CONFLICT") {
        return { ok: false, reason: "duplicate_invoice_number" };
      }
    }
    throw err;
  }
}
