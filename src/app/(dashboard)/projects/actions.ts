"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { createActivity } from "@/lib/activity/create-activity";
import { buildProjectMetadata } from "@/lib/activity/project-metadata";
import { deleteAttachmentsForParent, cleanupAttachmentStorageObjects } from "@/lib/attachments/attachment-mutations";
import { mapDeleteRestrictError } from "@/lib/delete-conflict-mapper";
import type { DeleteButtonActionResult } from "@/components/ui/delete-button";

export async function deleteProjectAction(projectId: string): Promise<DeleteButtonActionResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  // Delete, its Activity row, and Attachment cleanup are one atomic unit —
  // a failed Activity/Attachment insert (or an Invoice Restrict-FK
  // violation) rolls everything back together.
  let storagePaths: string[] | null;
  try {
    storagePaths = await prisma.$transaction(async (tx) => {
      // Snapshot taken before deletion — Activity.entityId is not a foreign
      // key, so this row (and its metadata) is what keeps the entry readable
      // once the Project row itself is gone.
      const existing = await tx.project.findFirst({
        where: { id: projectId, organizationId },
        include: { client: { select: { name: true } } },
      });

      if (!existing) {
        return null;
      }

      const result = await tx.project.deleteMany({
        where: { id: projectId, organizationId },
      });

      if (result.count === 0) {
        return null;
      }

      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "PROJECT",
        entityId: projectId,
        action: "DELETED",
        metadata: buildProjectMetadata(existing, existing.client.name, user.name),
      });

      // No further descendants carry Attachments — Task has no attachment
      // type at all, and Invoice's Restrict FK on projectId means a Project
      // with any Invoice can never reach this point in the first place.
      const { storagePaths } = await deleteAttachmentsForParent(tx, {
        organizationId,
        actorId: user.id,
        actorName: user.name,
        targets: [{ entityType: "PROJECT", entityId: projectId, parentEntityLabel: existing.name }],
      });

      return storagePaths;
    });
  } catch (err) {
    // Post-Hardening Residual Code Audit (P2) — same reasoning as
    // deleteClientAction's own identical catch: a Project with existing
    // Invoices is correctly blocked by Invoice.projectId's onDelete:
    // Restrict (never automatically deleted/cancelled, never cascaded
    // around) — this only replaces the generic "Failed to delete
    // {itemName}." with a specific, controlled reason. Any other failure
    // is not positively matched and keeps propagating as before.
    if (mapDeleteRestrictError(err, "Project") === "HAS_DEPENDENT_INVOICES") {
      return { ok: false };
    }
    throw err;
  }

  if (storagePaths) {
    await cleanupAttachmentStorageObjects(storagePaths);
  }

  revalidatePath("/projects");
  return { ok: true };
}
