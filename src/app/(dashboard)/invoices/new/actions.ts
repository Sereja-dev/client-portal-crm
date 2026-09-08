"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { parseInvoiceForm, mapInvoiceCalculationError } from "@/lib/validation/invoice";
import { withToast } from "@/lib/toast-url";
import { createActivity } from "@/lib/activity/create-activity";
import { buildInvoiceSnapshotMetadata } from "@/lib/activity/invoice-metadata";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { mapInvoiceWriteError } from "@/lib/invoices/write-conflict-mapper";
import { resolveInvoiceTarget } from "@/lib/invoices/target";
import { checkRateLimit, INVOICE_CREATE_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import type { InvoiceFormState } from "@/types";

export async function createInvoiceAction(
  _prevState: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const parsed = parseInvoiceForm(formData);
  if (!parsed.ok) {
    return { error: null, fieldErrors: parsed.fieldErrors, lineItemErrors: parsed.lineItemErrors };
  }
  const { values } = parsed;

  const { user, organizationId } = await getCurrentUserOrganization();

  // Keyed by the authenticated staff user id — never anything from
  // formData — same "auth resolved first, rate limit checked immediately
  // after" ordering every other per-user limiter in this app already
  // uses (see e.g. createCommentForEntity).
  const limitCheck = checkRateLimit(INVOICE_CREATE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  // Quotes / Estimates Phase 2.3 — clientId REQUIRED, projectId OPTIONAL
  // (Invoice / Project Coupling Audit's own durable invariant). The
  // <select>s only list this org's own Clients/Projects, but the
  // submitted values are still client-controlled input — re-verify
  // ownership server-side, and (when a Project is supplied) that it
  // belongs to the exact same Client, so a tampered pair can never
  // attach an invoice to another org's Client/Project or mismatch the
  // two. Never a distinguishable response for "foreign" vs "nonexistent"
  // vs "mismatched" — resolveInvoiceTarget's own invalid_target result
  // covers all three identically.
  const targetResult = await resolveInvoiceTarget(prisma, organizationId, {
    clientId: values.clientId,
    projectId: values.projectId,
  });
  if (!targetResult.ok) {
    return { error: null, fieldErrors: { clientId: "Select a valid client." } };
  }
  const { target } = targetResult;

  const calc = calculateInvoiceTotals({
    subtotalSource:
      values.mode === "flat"
        ? { mode: "flat", amount: values.amount ?? "" }
        : { mode: "lineItems", lineItems: values.lineItems ?? [] },
    discount:
      values.discountType === "NONE"
        ? { type: "NONE" }
        : { type: values.discountType, value: values.discountValue ?? "" },
    taxRatePercent: values.taxRatePercent,
  });

  if (!calc.ok) {
    const mapped = mapInvoiceCalculationError(calc.error, values.mode);
    return { error: null, fieldErrors: mapped.fieldErrors, lineItemErrors: mapped.lineItemErrors };
  }

  let projectName: string | null = null;
  if (target.projectId) {
    const project = await prisma.project.findUnique({ where: { id: target.projectId }, select: { name: true } });
    projectName = project?.name ?? null;
  }

  try {
    // Invoice create and its Activity row are one atomic unit — if the
    // Activity insert fails for any reason, the Invoice create rolls back
    // with it rather than leaving an unlogged row behind.
    await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: values.invoiceNumber,
          // Forced — never from formData. Direct creation in any other
          // status is forbidden (docs/invoicing-architecture.md §3.1).
          status: "DRAFT",
          paidAt: null,
          // The server always recomputes every total and discards any
          // client-submitted total — calc.total/subtotal/discountAmount/
          // taxAmount are the only values ever written here.
          amount: calc.total,
          subtotal: calc.subtotal,
          discountAmount: calc.discountAmount,
          taxAmount: calc.taxAmount,
          discountType: values.discountType,
          discountValue: values.discountType === "NONE" ? null : values.discountValue,
          taxRatePercent: values.taxRatePercent,
          taxLabel: values.taxLabel,
          currency: values.currency,
          issueDate: values.issueDate,
          dueDate: values.dueDate,
          notes: values.notes,
          internalNotes: values.internalNotes,
          // Resolved and re-verified server-side above — never taken from
          // formData directly, and never derived from one another; a
          // project-less Invoice (projectId: null) is a fully valid,
          // first-class target here.
          clientId: target.clientId,
          projectId: target.projectId,
          organizationId,
          lineItems:
            values.mode === "itemized"
              ? {
                  create: calc.lineItems.map((lineItem, index) => ({
                    description: lineItem.description,
                    quantity: lineItem.quantity,
                    unitPrice: lineItem.unitPrice,
                    lineTotal: lineItem.lineTotal,
                    position: index,
                  })),
                }
              : undefined,
        },
      });

      // INVOICE/CREATED has no entry in notification-rules.ts's RULES
      // table — only STATUS_CHANGED ever fans out to a Notification. No
      // notification rule is invented here.
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "INVOICE",
        entityId: invoice.id,
        action: "CREATED",
        metadata: buildInvoiceSnapshotMetadata(invoice, calc.lineItems.length, projectName, user.name),
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      if (mapInvoiceWriteError(err) === "INVOICE_NUMBER_CONFLICT") {
        return {
          error: null,
          fieldErrors: {
            invoiceNumber: "An invoice with this number already exists.",
          },
        };
      }
      return { error: "This invoice could not be saved due to a conflicting change. Please try again." };
    }
    throw err;
  }

  redirect(withToast("/invoices", "Invoice created"));
}
