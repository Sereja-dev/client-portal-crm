"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import { createTimeEntry, updateTimeEntry, archiveTimeEntry, unarchiveTimeEntry } from "@/lib/time-entries/entries";
import { combineDurationInput } from "@/lib/time-entries/duration";
import { withToast } from "@/lib/toast-url";
import type { TimeEntryFormState } from "@/types";

/**
 * Time Tracking Phase 2A — Staff Server Action layer. Every action here
 * resolves the authenticated staff member itself (getCurrentMembership())
 * and calls straight into the existing Phase 1 domain functions
 * (src/lib/time-entries/entries.ts) — no authorization logic is
 * duplicated here, and every mutator's own return value (already a
 * safe, generic discriminated union — never a raw Prisma error) is
 * translated into a plain {error}/{fieldErrors} shape, the same
 * "Server Action returns/maps the domain result, never invents its own
 * check" convention every other Phase 2A this session already
 * established.
 */

const GENERIC_ERROR = "Something went wrong. Please try again.";
const DURATION_ERROR = "Enter a valid duration — whole hours and 0-59 minutes, up to 24 hours total.";

function revalidateTimePaths(entryId?: string) {
  revalidatePath("/time");
  if (entryId) {
    revalidatePath(`/time/${entryId}`);
  }
}

/**
 * Every failure reason createTimeEntry/updateTimeEntry can return, mapped
 * to a safe, user-facing message — never a raw internal error string.
 * FORBIDDEN/INVALID_TARGET_USER/INVALID_PROJECT/INVALID_TASK/
 * TASK_PROJECT_MISMATCH/ENTRY_NOT_FOUND are all genuinely unreachable
 * through this form's own well-behaved UI (the member selector is never
 * rendered for a MEMBER, the Project/Task selects only ever offer
 * same-org/same-project options) — handled explicitly anyway, per this
 * app's existing "the boundary enforces it independently of what the UI
 * does or doesn't offer" convention.
 */
function mapFailureToFormState(reason: string): TimeEntryFormState {
  switch (reason) {
    case "FORBIDDEN":
      return { error: "You don't have permission to do that." };
    case "INVALID_TARGET_USER":
      return { error: null, fieldErrors: { userId: "Select a valid team member." } };
    case "INVALID_PROJECT":
      return { error: null, fieldErrors: { projectId: "Select a valid project." } };
    case "INVALID_TASK":
      return { error: null, fieldErrors: { taskId: "Select a valid task for this project." } };
    case "TASK_PROJECT_MISMATCH":
      return { error: null, fieldErrors: { taskId: "This task no longer belongs to the selected project. Choose another task or clear it." } };
    case "ENTRY_NOT_FOUND":
      return { error: "This time entry is no longer available." };
    default:
      return { error: GENERIC_ERROR };
  }
}

export async function createTimeEntryAction(_prevState: TimeEntryFormState, formData: FormData): Promise<TimeEntryFormState> {
  const { user, organizationId, membership } = await getCurrentMembership();

  const duration = combineDurationInput(formData.get("hours"), formData.get("minutes"));
  if (!duration.ok) {
    return { error: null, fieldErrors: { durationMinutes: DURATION_ERROR } };
  }

  const result = await createTimeEntry(organizationId, { id: user.id, name: user.name, role: membership.role }, {
    userId: formData.get("userId"),
    projectId: formData.get("projectId"),
    taskId: formData.get("taskId") || null,
    workDate: formData.get("workDate"),
    durationMinutes: duration.totalMinutes,
    description: formData.get("description"),
    billable: formData.get("billable") === "on",
  });

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: null, fieldErrors: result.fieldErrors };
    }
    return mapFailureToFormState(result.reason);
  }

  revalidateTimePaths();
  redirect(withToast(`/time/${result.entry.id}`, "Time entry logged"));
}

export async function updateTimeEntryAction(
  entryId: string,
  _prevState: TimeEntryFormState,
  formData: FormData,
): Promise<TimeEntryFormState> {
  const { user, organizationId, membership } = await getCurrentMembership();

  const duration = combineDurationInput(formData.get("hours"), formData.get("minutes"));
  if (!duration.ok) {
    return { error: null, fieldErrors: { durationMinutes: DURATION_ERROR } };
  }

  const result = await updateTimeEntry(organizationId, entryId, { id: user.id, name: user.name, role: membership.role }, {
    userId: formData.get("userId"),
    projectId: formData.get("projectId"),
    taskId: formData.get("taskId") || null,
    workDate: formData.get("workDate"),
    durationMinutes: duration.totalMinutes,
    description: formData.get("description"),
    billable: formData.get("billable") === "on",
  });

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: null, fieldErrors: result.fieldErrors };
    }
    return mapFailureToFormState(result.reason);
  }

  revalidateTimePaths(entryId);
  redirect(withToast(`/time/${entryId}`, "Time entry updated"));
}

export type ArchiveTimeEntryActionResult = { ok: true } | { ok: false; reason: string };

export async function archiveTimeEntryAction(entryId: string): Promise<ArchiveTimeEntryActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();

  const result = await archiveTimeEntry(organizationId, entryId, { id: user.id, name: user.name, role: membership.role });
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  revalidateTimePaths(entryId);
  return { ok: true };
}

export async function unarchiveTimeEntryAction(entryId: string): Promise<ArchiveTimeEntryActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();

  const result = await unarchiveTimeEntry(organizationId, entryId, { id: user.id, name: user.name, role: membership.role });
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  revalidateTimePaths(entryId);
  return { ok: true };
}
