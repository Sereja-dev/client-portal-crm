"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import { formatStatusLabel } from "@/lib/format";
import { CLIENT_REQUEST_STATUSES, CLIENT_REQUEST_PRIORITIES } from "@/lib/validation/client-request";
import {
  updateClientRequestStatusAction,
  updateClientRequestPriorityAction,
  assignClientRequestAction,
  linkClientRequestProjectAction,
  archiveClientRequestAction,
  unarchiveClientRequestAction,
} from "@/app/(dashboard)/requests/actions";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Client Requests / Tickets Phase 2A — the Staff detail page's own
 * status/priority/assignee/project/archive surface. Mirrors
 * leads/lead-actions-panel.tsx's own exact shape: one shared
 * useTransition, every mutation calls straight into
 * src/app/(dashboard)/requests/actions.ts (which itself calls straight
 * into the unchanged Phase 1 domain layer — no authorization logic
 * duplicated here), router.refresh() on every success so this panel
 * never keeps its own duplicate copy of the request's real current
 * state. `members`/`projects` are both pre-filtered server-side by the
 * detail page (organization Memberships / this exact Client's own
 * Projects) — this component never fetches or filters anything itself.
 */
export function StaffRequestControls({
  requestId,
  status,
  priority,
  assignedToId,
  projectId,
  archivedAt,
  members,
  projects,
}: {
  requestId: string;
  status: string;
  priority: string;
  assignedToId: string | null;
  projectId: string | null;
  archivedAt: string | null;
  /** Same-organization Memberships only — resolved server-side by the detail page, never client-supplied. */
  members: { id: string; name: string }[];
  /** This request's own Client's Projects only — resolved server-side by the detail page, never client-supplied. */
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const archiveDialogRef = useRef<ConfirmDialogHandle>(null);

  const isArchived = archivedAt !== null;

  function handleStatusChange(value: string) {
    startTransition(async () => {
      const result = await updateClientRequestStatusAction(requestId, value);
      if (result.ok) {
        showToast("Status updated");
        router.refresh();
        return;
      }
      showToast(result.reason === "INVALID_STATUS" ? "Select a valid status." : GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  function handlePriorityChange(value: string) {
    startTransition(async () => {
      const result = await updateClientRequestPriorityAction(requestId, value);
      if (result.ok) {
        showToast("Priority updated");
        router.refresh();
        return;
      }
      showToast(result.reason === "INVALID_PRIORITY" ? "Select a valid priority." : GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  function handleAssigneeChange(value: string) {
    startTransition(async () => {
      const result = await assignClientRequestAction(requestId, value || null);
      if (result.ok) {
        showToast(value ? "Assignee updated" : "Unassigned");
        router.refresh();
        return;
      }
      showToast(result.reason === "INVALID_ASSIGNEE" ? "That member can't be assigned." : GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  function handleProjectChange(value: string) {
    startTransition(async () => {
      const result = await linkClientRequestProjectAction(requestId, value || null);
      if (result.ok) {
        showToast(value ? "Project linked" : "Project unlinked");
        router.refresh();
        return;
      }
      showToast(result.reason === "INVALID_PROJECT" ? "That project can't be linked." : GENERIC_ERROR, "error");
      router.refresh();
    });
  }

  function handleArchiveToggle(archive: boolean) {
    startTransition(async () => {
      const result = archive ? await archiveClientRequestAction(requestId) : await unarchiveClientRequestAction(requestId);
      if (result.ok) {
        showToast(archive ? "Request archived" : "Request unarchived");
        router.refresh();
        return;
      }
      showToast(GENERIC_ERROR, "error");
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="request-status" className="text-text-secondary mb-1 block text-sm font-medium">
            Status
          </label>
          <Select
            id="request-status"
            value={status}
            disabled={isPending || isArchived}
            onChange={(event) => handleStatusChange(event.target.value)}
          >
            {CLIENT_REQUEST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {formatStatusLabel(value)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="request-priority" className="text-text-secondary mb-1 block text-sm font-medium">
            Priority
          </label>
          <Select
            id="request-priority"
            value={priority}
            disabled={isPending || isArchived}
            onChange={(event) => handlePriorityChange(event.target.value)}
          >
            {CLIENT_REQUEST_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {formatStatusLabel(value)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="request-assignee" className="text-text-secondary mb-1 block text-sm font-medium">
            Assignee
          </label>
          <Select
            id="request-assignee"
            value={assignedToId ?? ""}
            disabled={isPending || isArchived}
            onChange={(event) => handleAssigneeChange(event.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="request-project" className="text-text-secondary mb-1 block text-sm font-medium">
            Project
          </label>
          <Select
            id="request-project"
            value={projectId ?? ""}
            disabled={isPending || isArchived || projects.length === 0}
            onChange={(event) => handleProjectChange(event.target.value)}
          >
            <option value="">None</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        {isArchived ? (
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => handleArchiveToggle(false)}>
            Unarchive
          </Button>
        ) : (
          <>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => archiveDialogRef.current?.open()}>
              Archive
            </Button>
            <ConfirmDialog
              ref={archiveDialogRef}
              title="Archive request"
              description="Archived requests are hidden from the default list, and the Client can no longer view or message it. You can unarchive it later."
              confirmLabel="Archive"
              onConfirm={() => handleArchiveToggle(true)}
            />
          </>
        )}
      </div>
    </div>
  );
}
