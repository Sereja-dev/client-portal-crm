"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { createActivity } from "@/lib/activity/create-activity";
import { buildProjectMetadata } from "@/lib/activity/project-metadata";
import { deleteAttachmentsForParent, cleanupAttachmentStorageObjects } from "@/lib/attachments/attachment-mutations";
import { deleteCustomFieldValuesForEntities } from "@/lib/custom-fields/values";
import type { DeleteButtonActionResult } from "@/components/ui/delete-button";

/**
 * Quotes / Estimates Phase 2.4 (Invoice / Project Coupling Audit) —
 * Invoice.projectId's own FK is now `onDelete: SetNull`, not `Restrict`.
 * A Project may be deleted even while Invoices still reference it: the
 * database itself resets each such Invoice's `projectId` to null as part
 * of this same delete, and those Invoices survive as ordinary,
 * fully-supported Client-only Invoices (Phase 2.3 made that a first-class
 * state everywhere). No application code needs to null the column, defer
 * to a conflict, or write any Invoice-side Activity for this — it is a
 * plain, atomic side effect of the one DELETE statement below. Task
 * itself is still `onDelete: Cascade` (deleted along with the Project,
 * unchanged) and has no attachment type of its own. This used to also
 * handle an Invoice-Restrict-FK conflict (`mapDeleteRestrictError(err,
 * "Project") === "HAS_DEPENDENT_INVOICES"`) — removed as dead code now
 * that Invoice can no longer ever cause that violation; Project has no
 * other Restrict-class dependent today, so no replacement conflict
 * handling is needed. If a future model ever adds one, an unrecognized
 * Prisma error here still propagates uncaught exactly as it always has,
 * matching this app's own generic-failure handling elsewhere.
 */
export async function deleteProjectAction(projectId: string): Promise<DeleteButtonActionResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  // Delete, its Activity row, and Attachment cleanup are one atomic unit —
  // a failed Activity/Attachment insert rolls everything back together.
  const storagePaths = await prisma.$transaction(async (tx) => {
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
    // type at all.
    const { storagePaths } = await deleteAttachmentsForParent(tx, {
      organizationId,
      actorId: user.id,
      actorName: user.name,
      targets: [{ entityType: "PROJECT", entityId: projectId, parentEntityLabel: existing.name }],
    });

    // Custom Fields Phase 1 (Section P) — CustomFieldValue carries no
    // literal FK to Project (see that model's own schema comment), so it
    // would otherwise orphan silently on this hard delete exactly the way
    // Attachments would have without the call just above.
    await deleteCustomFieldValuesForEntities(tx, {
      organizationId,
      entityIds: [projectId],
    });

    return storagePaths;
  });

  if (storagePaths) {
    await cleanupAttachmentStorageObjects(storagePaths);
  }

  revalidatePath("/projects");
  return { ok: true };
}
