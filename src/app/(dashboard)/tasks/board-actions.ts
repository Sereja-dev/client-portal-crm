"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { changeTaskStatus } from "@/lib/tasks/mutations";

// Not exported — a "use server" file may only export async functions
// (confirmed directly: exporting a type here breaks the build with "The
// module has no exports at all"). Only used as this file's own internal
// return-type annotation.
type UpdateTaskStatusResult = { ok: true } | { ok: false; reason: string };

/**
 * Task Board V1 — the one write path a card drop calls. Reuses
 * `changeTaskStatus` (src/lib/tasks/mutations.ts) — the same domain
 * function Bulk status changes use — so a Board move and a Bulk status
 * change can never diverge on completedAt/Activity semantics (read-only
 * audit §24). There is no position/ordering field on Task (confirmed
 * during the readiness audit, mirroring Lead's own identical absence) —
 * dropping a card into a DIFFERENT column changes its status; dropping it
 * back into its OWN column is a genuine no-op (changeTaskStatus's own
 * "no change, no Activity" short-circuit), never a persisted reorder.
 */
export async function updateTaskStatusAction(taskId: string, newStatus: string): Promise<UpdateTaskStatusResult> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const result = await changeTaskStatus(organizationId, { id: user.id, name: user.name }, taskId, newStatus);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  revalidatePath("/tasks");
  return { ok: true };
}
