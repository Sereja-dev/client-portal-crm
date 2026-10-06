"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { updateClientRequestStatus, assignClientRequest } from "@/lib/client-requests/staff";
import { BULK_SELECTION_MAX, type BulkActionResult } from "@/lib/bulk-actions/shared";

/**
 * Tables Improvement Slice C — Support Requests' two approved V1 bulk
 * actions: status change and assignment, on the Active (non-archived)
 * view only — the detail page's own StaffRequestControls already
 * disables these same two controls once a request is archived
 * (`disabled={isPending || isArchived}`), so bulk controls follow that
 * exact existing convention rather than broadening archived mutability
 * merely because a bulk surface now exists (locked spec §14).
 *
 * Mirrors Tasks' own bulk-actions.ts architecture exactly: every id is
 * processed through the exact same single-record domain function
 * (src/lib/client-requests/staff.ts's own updateClientRequestStatus/
 * assignClientRequest — never the Server Action wrapper, since this
 * file already resolves {organizationId, actor} once itself, exactly
 * like Tasks' own bulk-actions.ts calls straight into
 * src/lib/tasks/mutations.ts rather than through
 * src/app/(dashboard)/tasks/actions.ts) the detail page's own
 * StaffRequestControls already calls — so single/bulk status and
 * assignment semantics can never drift. Every status->status
 * transition remains unrestricted (no new transition graph invented
 * here), and assignee eligibility (must hold a real Membership in this
 * organization) is enforced by assignClientRequest() itself, per row —
 * a bad assigneeId fails every row individually with INVALID_ASSIGNEE
 * before ever calling `update`, which already satisfies "fail safely
 * before mutating any record" without a separate pre-flight check.
 *
 * A stale/foreign id fails for that one row only (REQUEST_NOT_FOUND,
 * already indistinguishable from "never existed") — it never aborts
 * the ids that did succeed, and no giant `updateMany` shortcut is ever
 * used (that would bypass the Activity-logging and resolvedAt
 * bookkeeping both single-record functions already own).
 */

async function runBulk(
  requestIds: string[],
  mutate: (requestId: string) => Promise<{ ok: true } | { ok: false; reason: string }>,
): Promise<BulkActionResult> {
  const boundedIds = requestIds.slice(0, BULK_SELECTION_MAX);

  let updatedCount = 0;
  const failures: { id: string; reason: string }[] = [];

  for (const requestId of boundedIds) {
    const result = await mutate(requestId);
    if (result.ok) {
      updatedCount++;
    } else {
      failures.push({ id: requestId, reason: result.reason });
    }
  }

  revalidatePath("/requests");
  return { updatedCount, failedCount: failures.length, failures };
}

export async function bulkUpdateClientRequestStatusAction(requestIds: string[], newStatus: string): Promise<BulkActionResult> {
  if (requestIds.length > BULK_SELECTION_MAX) {
    return { updatedCount: 0, failedCount: requestIds.length, failures: [{ id: "", reason: "TOO_MANY_SELECTED" }] };
  }
  const { user, organizationId } = await getCurrentUserOrganization();
  return runBulk(requestIds, (requestId) =>
    updateClientRequestStatus(organizationId, requestId, newStatus, { id: user.id, name: user.name }),
  );
}

export async function bulkAssignClientRequestAction(
  requestIds: string[],
  assignedToId: string | null,
): Promise<BulkActionResult> {
  if (requestIds.length > BULK_SELECTION_MAX) {
    return { updatedCount: 0, failedCount: requestIds.length, failures: [{ id: "", reason: "TOO_MANY_SELECTED" }] };
  }
  const { user, organizationId } = await getCurrentUserOrganization();
  return runBulk(requestIds, (requestId) =>
    assignClientRequest(organizationId, requestId, assignedToId, { id: user.id, name: user.name }),
  );
}
