"use client";

import { useActionState, useImperativeHandle, useRef, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { DialogShell, DialogTitle, DialogActions } from "@/components/ui/dialog-shell";
import { createTimeEntryAction } from "@/app/(dashboard)/time/actions";
import type { TimeEntryFormState } from "@/types";

const initialState: TimeEntryFormState = { error: null };

export type TaskQuickLogDialogHandle = { open: () => void };

/**
 * Projects & Tasks Work Hub V1 — the one small quick-log surface reused
 * identically from the Task List, a Task Board card, and the Project
 * Hub's own Tasks tab (read-only audit §11/§20's own explicit
 * instruction: "reuse the existing TimeEntry domain/action... do NOT
 * create a second time-entry write path"). This dialog is a thin UI shell
 * only — it submits straight to the real, unmodified `createTimeEntryAction`
 * (src/app/(dashboard)/time/actions.ts), which itself calls the same
 * `createTimeEntry` domain function (src/lib/time-entries/entries.ts) the
 * full /time/new page already uses. Every validation rule there —
 * duration bounds, `TASK_PROJECT_MISMATCH`, tenant/cross-org rejection —
 * remains fully authoritative; nothing here bypasses or duplicates it.
 *
 * `userId` is a hidden field, always the current Staff member — this
 * quick dialog deliberately never offers the member-selector the full
 * /time/new page shows to OWNER/ADMIN (logging time FOR someone else is
 * an edge case the full form already serves; "quick" log is About
 * logging your own time fast). `taskId`/`projectId` are likewise hidden,
 * prefilled from the Task this dialog was opened for — never a second
 * project/task picker.
 *
 * On success, `createTimeEntryAction` redirects to `/time/{id}` with a
 * toast (its own existing, unmodified behavior) — this dialog does not
 * intercept or suppress that; the browser navigates away, which is also
 * what closes the dialog. A deliberate, documented V1 simplification
 * (not a "stay in place" modal) rather than inventing a second, parallel
 * non-redirecting action.
 */
export function TaskQuickLogDialog({
  ref,
  taskId,
  taskTitle,
  projectId,
  currentUserId,
}: {
  ref?: Ref<TaskQuickLogDialogHandle>;
  taskId: string;
  taskTitle: string;
  projectId: string;
  currentUserId: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(createTimeEntryAction, initialState);

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.showModal(),
  }));

  return (
    <DialogShell
      ref={dialogRef}
      aria-labelledby="quick-log-title"
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
    >
      <DialogTitle id="quick-log-title">Log time — {taskTitle}</DialogTitle>

      {/*
       * Visual Design Improvement V2 — the field list keeps its own
       * `space-y-4` scope on this inner wrapper, deliberately NOT on
       * <form> itself: DialogActions below has its own `mt-6` margin,
       * and nesting it inside a `space-y-4` parent would put two
       * separate margin-top utilities on the same element (the sibling
       * rule space-y-4 generates, plus DialogActions' own mt-6) —
       * exactly the "which utility wins is a build-order detail, not a
       * reliable one" class of bug button.tsx's own history already
       * documents (there as a bg-/text-color conflict; here it would be
       * a margin conflict). Keeping DialogActions a sibling of this div,
       * not a descendant, avoids the conflict entirely rather than
       * relying on which rule happens to win.
       */}
      <form action={formAction} className="mt-4">
        <div className="space-y-4">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="userId" value={currentUserId} />

        <FormField label="Work date" htmlFor="quick-log-workDate" required error={state.fieldErrors?.workDate}>
          <Input
            id="quick-log-workDate"
            name="workDate"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Hours" htmlFor="quick-log-hours" error={state.fieldErrors?.durationMinutes}>
            <Input id="quick-log-hours" name="hours" type="number" min={0} max={24} defaultValue={0} />
          </FormField>
          <FormField label="Minutes" htmlFor="quick-log-minutes">
            <Input id="quick-log-minutes" name="minutes" type="number" min={0} max={59} defaultValue={0} />
          </FormField>
        </div>

        <FormField label="Description" htmlFor="quick-log-description">
          <Textarea id="quick-log-description" name="description" rows={2} />
        </FormField>

        <label className="text-text-secondary flex items-center gap-2 text-sm">
          <input type="checkbox" name="billable" defaultChecked className="h-4 w-4" />
          Billable
        </label>

        {/*
         * Work Hub Production audit's own proven defect: taskId (and the
         * other two hidden fields, projectId/userId) had no visible error
         * slot at all, so a genuine INVALID_TASK/INVALID_PROJECT/
         * INVALID_TARGET_USER rejection — e.g. a historical Task that was
         * previously wrongly rejected before entries.ts's own tenant-scope
         * fix — was silently dropped: the dialog's uncontrolled fields
         * reset (React's own documented behavior after any action
         * transition, regardless of outcome) with nothing to tell the user
         * it had failed. workDate/durationMinutes keep their own existing
         * FormField-attached rendering above, unduplicated here.
         */}
        {(state.error || state.fieldErrors?.taskId || state.fieldErrors?.projectId || state.fieldErrors?.userId) && (
          <p role="alert" className="text-danger text-sm">
            {state.error ?? state.fieldErrors?.taskId ?? state.fieldErrors?.projectId ?? state.fieldErrors?.userId}
          </p>
        )}
        </div>

        <DialogActions>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <Button type="submit" loading={pending}>
            {pending ? "Logging…" : "Log time"}
          </Button>
        </DialogActions>
      </form>
    </DialogShell>
  );
}
