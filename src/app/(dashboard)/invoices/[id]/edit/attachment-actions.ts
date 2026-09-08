"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { uploadAttachmentForEntity, deleteAttachmentForEntity } from "@/lib/attachments/attachment-mutations";
import type { AttachmentUploadState } from "@/types";

export async function uploadAttachmentAction(
  invoiceId: string,
  _prevState: AttachmentUploadState,
  formData: FormData,
): Promise<AttachmentUploadState> {
  const { user, organizationId } = await getCurrentUserOrganization();

  // Scoped by organizationId alone (Invoice's own column) — never by id
  // alone, consistent with updateInvoiceAction and the edit page's own
  // lookup. A foreign org's invoice id simply doesn't match. Never a
  // project relation filter, which would silently exclude a project-less
  // Invoice (Quotes / Estimates Phase 2.3).
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: { id: true, invoiceNumber: true },
  });
  if (!invoice) {
    return { error: "This invoice could not be found." };
  }

  const result = await uploadAttachmentForEntity({
    organizationId,
    actorId: user.id,
    actorName: user.name,
    entityType: "INVOICE",
    entityId: invoiceId,
    parentEntityLabel: invoice.invoiceNumber,
    formData,
  });

  if (result.error === null) {
    revalidatePath(`/invoices/${invoiceId}/edit`);
  }
  return result;
}

export async function deleteAttachmentAction(invoiceId: string, attachmentId: string): Promise<void> {
  const { user, organizationId } = await getCurrentUserOrganization();

  await deleteAttachmentForEntity({
    organizationId,
    actorId: user.id,
    actorName: user.name,
    attachmentId,
    entityType: "INVOICE",
    resolveParentLabel: async (entityId) => {
      const parentInvoice = await prisma.invoice.findFirst({
        where: { id: entityId, organizationId },
        select: { invoiceNumber: true },
      });
      return parentInvoice?.invoiceNumber ?? null;
    },
  });

  revalidatePath(`/invoices/${invoiceId}/edit`);
}
