"use client";

import { useActionState, useImperativeHandle, useRef, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
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
    <dialog
      ref={dialogRef}
      aria-labelledby="quick-log-title"
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      className={`border-border-default bg-surface w-full max-w-sm rounded-lg border p-6 shadow-xl backdrop:bg-black/40 ${DIALOG_CENTER_CLASSES}`}
    >
      <h2 id="quick-log-title" className="text-text-primary text-base font-semibold">
        Log time — {taskTitle}
      </h2>

      <form action={formAction} className="mt-4 space-y-4">
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

        {state.error && (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
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
        </div>
      </form>
    </dialog>
  );
}
