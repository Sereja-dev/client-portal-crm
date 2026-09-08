"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { createActivity } from "@/lib/activity/create-activity";
import { buildClientActivityMetadata } from "@/lib/activity/client-metadata";
import { deleteAttachmentsForParent, cleanupAttachmentStorageObjects } from "@/lib/attachments/attachment-mutations";
import { mapDeleteRestrictError } from "@/lib/delete-conflict-mapper";
import type { DeleteButtonActionResult } from "@/components/ui/delete-button";

export async function deleteClientAction(clientId: string): Promise<DeleteButtonActionResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  // Delete, its (conditional) Activity row, and Attachment cleanup are one
  // atomic unit — a failed Activity/Attachment insert (or an Invoice
  // Restrict-FK violation cascading from the delete itself) rolls
  // everything back together, including any Attachment rows this would
  // otherwise have cleaned up.
  let storagePaths: string[] | null;
  try {
    storagePaths = await prisma.$transaction(async (tx) => {
      // Snapshot taken before deletion — Activity.entityId is not a foreign
      // key, so this row (and its metadata) is what keeps the entry readable
      // once the Client row itself is gone.
      const existing = await tx.client.findFirst({
        where: { id: clientId, organizationId },
      });

      if (!existing) {
        return null;
      }

      // Projects that will cascade-delete alongside this Client (Project.clientId
      // is onDelete: Cascade) — queried before the delete, since Postgres
      // removes them silently at the SQL level with no application code
      // running for them; their own Attachments would otherwise be orphaned.
      const childProjects = await tx.project.findMany({
        where: { clientId, organizationId },
        select: { id: true, name: true },
      });

      const result = await tx.client.deleteMany({
        where: { id: clientId, organizationId },
      });

      if (result.count === 0) {
        return null;
      }

      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "CLIENT",
        entityId: clientId,
        action: "DELETED",
        metadata: buildClientActivityMetadata(existing, user.name),
      });

      const { storagePaths } = await deleteAttachmentsForParent(tx, {
        organizationId,
        actorId: user.id,
        actorName: user.name,
        targets: [
          { entityType: "CLIENT", entityId: clientId, parentEntityLabel: existing.name },
          ...childProjects.map((project) => ({
            entityType: "PROJECT" as const,
            entityId: project.id,
            parentEntityLabel: project.name,
          })),
        ],
      });

      return storagePaths;
    });
  } catch (err) {
    // Post-Hardening Residual Code Audit (P2), extended by Quotes /
    // Estimates Phase 2 — a Client with existing Invoices OR Quotes is
    // correctly blocked by the schema's own onDelete: Restrict on each
    // (never automatically deleted/cancelled here, and never cascaded
    // around). This replaces DeleteButton's own generic "Failed to
    // delete {itemName}." with the specific, controlled reason that
    // actually applies — Quote.clientId is also Restrict (Phase 1), so a
    // bare boolean can no longer tell a caller which dependent actually
    // blocked the delete; mapDeleteRestrictError's own return value
    // already distinguishes the two, and this action passes the matching
    // message straight through via DeleteButton's own `message` field.
    // Any other failure (a bug, a connection error, an unrelated
    // constraint) is not positively matched and keeps propagating exactly
    // as before this change, to the same generic handling.
    const conflict = mapDeleteRestrictError(err, "Client");
    if (conflict === "HAS_DEPENDENT_INVOICES") {
      return { ok: false, message: "This client can't be deleted because it has existing invoices." };
    }
    if (conflict === "HAS_DEPENDENT_QUOTES") {
      return { ok: false, message: "This client can't be deleted because it has existing quotes." };
    }
    throw err;
  }

  if (storagePaths) {
    await cleanupAttachmentStorageObjects(storagePaths);
  }

  revalidatePath("/clients");
  return { ok: true };
}
