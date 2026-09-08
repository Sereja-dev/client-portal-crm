import { prisma } from "@/lib/prisma";
import type { AttachmentEntityType } from "@/generated/prisma/enums";
import { VISIBLE_PORTAL_STATUSES } from "./queries";

export type PortalAttachmentParentType = AttachmentEntityType;

export type PortalAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  parentType: PortalAttachmentParentType;
  /** e.g. "Client", a project's name, or an invoice's number — never a
   * staff/internal identifier. */
  parentLabel: string;
};

// uploadedBy is deliberately never selected here — a portal contact has no
// business seeing which staff member uploaded a file, and storageBucket/
// storagePath must never leave this module (the download route is the
// only thing that reads them, and only after its own re-verification).
const ATTACHMENT_DISPLAY_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

/**
 * Client-level (CLIENT) attachments for the current portal identity's own
 * Client. clientId and organizationId must both come from
 * getCurrentPortalUser() — never re-derived from anything user-suppliable.
 */
export async function getPortalClientAttachments(
  clientId: string,
  organizationId: string,
): Promise<PortalAttachment[]> {
  const attachments = await prisma.attachment.findMany({
    where: { entityType: "CLIENT", entityId: clientId, organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ATTACHMENT_DISPLAY_SELECT,
  });

  return attachments.map((a) => ({ ...a, parentType: "CLIENT" as const, parentLabel: "Client" }));
}

/**
 * Project-level (PROJECT) attachments. The caller must already have scoped
 * the Project itself by id + clientId (see getPortalProject()) before
 * calling this — passing its id/name/organizationId straight through, not
 * re-deriving them. This function only re-applies the
 * entityType/entityId/organizationId boundary on the Attachment table.
 * A null Project.organizationId (pre-multi-tenant data) can never match
 * any Attachment row (Attachment.organizationId is non-nullable), so this
 * safely returns an empty list rather than querying with a null filter.
 */
export async function getPortalProjectAttachments(project: {
  id: string;
  name: string;
  organizationId: string | null;
}): Promise<PortalAttachment[]> {
  if (!project.organizationId) return [];

  const attachments = await prisma.attachment.findMany({
    where: { entityType: "PROJECT", entityId: project.id, organizationId: project.organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ATTACHMENT_DISPLAY_SELECT,
  });

  return attachments.map((a) => ({ ...a, parentType: "PROJECT" as const, parentLabel: project.name }));
}

/**
 * Invoice-level (INVOICE) attachments. Same contract as
 * getPortalProjectAttachments, except the organizationId boundary is the
 * Invoice's own `organizationId` column directly (Quotes / Estimates
 * Phase 2.3 — never derived from Project, which may not exist at all for
 * a project-less Invoice; deriving it that way would silently make every
 * project-less Invoice's attachments unreachable).
 */
export async function getPortalInvoiceAttachments(invoice: {
  id: string;
  invoiceNumber: string;
  organizationId: string;
}): Promise<PortalAttachment[]> {
  const attachments = await prisma.attachment.findMany({
    where: { entityType: "INVOICE", entityId: invoice.id, organizationId: invoice.organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ATTACHMENT_DISPLAY_SELECT,
  });

  return attachments.map((a) => ({ ...a, parentType: "INVOICE" as const, parentLabel: invoice.invoiceNumber }));
}

/**
 * The sole authorization check for the portal attachment download route.
 * Takes an Attachment row found by id alone (the id is never itself a
 * trust boundary) and independently re-verifies that its entityId really
 * names a CLIENT/PROJECT/INVOICE belonging to this exact clientId, and
 * that its organizationId matches this Client's own organization. Every
 * branch fails closed: an unrecognized entityType, an organizationId
 * mismatch, or an empty parent lookup (orphaned/mismatched Attachment) all
 * return false, never true.
 *
 * Client Portal Audit Finding 1: the INVOICE branch additionally requires
 * the Invoice's own status to be one of VISIBLE_PORTAL_STATUSES — the
 * exact same set getPortalInvoice()/getPortalInvoices() already use to
 * keep a DRAFT (or any other Portal-invisible) Invoice invisible on every
 * other Portal surface. Without this, an attachment attached to a DRAFT
 * Invoice belonging to this exact Client would otherwise still pass this
 * check and receive a signed download URL, even though the Invoice itself
 * is never visible anywhere in the Portal UI. The added predicate fails
 * closed identically to every other case here: a DRAFT (or other
 * ineligible) Invoice's attachment simply doesn't match, indistinguishable
 * from a nonexistent Invoice.
 */
export async function verifyPortalAttachmentAccess(
  attachment: { entityType: AttachmentEntityType; entityId: string; organizationId: string },
  identity: { clientId: string; organizationId: string },
): Promise<boolean> {
  if (attachment.organizationId !== identity.organizationId) return false;

  switch (attachment.entityType) {
    case "CLIENT":
      return attachment.entityId === identity.clientId;

    case "PROJECT": {
      const project = await prisma.project.findFirst({
        where: { id: attachment.entityId, clientId: identity.clientId },
        select: { id: true },
      });
      return !!project;
    }

    case "INVOICE": {
      const invoice = await prisma.invoice.findFirst({
        where: {
          id: attachment.entityId,
          clientId: identity.clientId,
          status: { in: [...VISIBLE_PORTAL_STATUSES] },
        },
        select: { id: true },
      });
      return !!invoice;
    }

    default:
      return false;
  }
}
