"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { TIME_ENTRY_DESCRIPTION_MAX_LENGTH } from "@/lib/validation/time-entry";
import { filterTasksByProject, isTaskValidForProject, type TimeEntryTaskOption } from "./filter-tasks-by-project";
import type { TimeEntryFormState } from "@/types";

const initialState: TimeEntryFormState = { error: null };

export type TimeEntryFormDefaults = {
  userId?: string;
  projectId?: string;
  taskId?: string | null;
  workDate?: string;
  hours?: number;
  minutes?: number;
  description?: string | null;
  billable?: boolean;
};

/**
 * Time Tracking Phase 2A — shared by /time/new and /time/[id]'s own edit
 * mode, the same "one form component, an `action` prop, and a
 * `defaultValues` prop" convention LeadForm/TaskForm/
 * LeadCaptureFormEditor already use.
 *
 * Member selection: `canSelectMember` is resolved server-side by the
 * calling page (actor role OWNER/ADMIN) — when false, this form never
 * renders a member `<select>` at all, only a hidden `userId` input fixed
 * to `actorId` (§"MEMBER SELECTION": "do NOT render a member selector").
 * The Server Action independently re-verifies authorization regardless
 * of what this component does or doesn't render.
 *
 * Project -> Task: `tasks` is every organization Task, already fetched
 * server-side with its own projectId attached — no request fires when
 * the Project select changes; filterTasksByProject/isTaskValidForProject
 * (pure, unit-tested directly) do a plain in-memory filter, and changing
 * Project clears the current Task selection if it no longer belongs to
 * the new Project. Server/domain validation remains authoritative — this
 * is a UI convenience only.
 */
export function TimeEntryForm({
  action,
  actorId,
  canSelectMember,
  members,
  projects,
  tasks,
  defaultValues,
  submitLabel = "Log time",
  pendingLabel = "Saving…",
}: {
  action: (prevState: TimeEntryFormState, formData: FormData) => Promise<TimeEntryFormState>;
  /** The authenticated actor's own User id — used as the fixed target when canSelectMember is false, and as the member select's own default when creating for self. */
  actorId: string;
  canSelectMember: boolean;
  /** Only meaningful when canSelectMember is true — organization Memberships. */
  members: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  tasks: TimeEntryTaskOption[];
  defaultValues?: TimeEntryFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [selectedProjectId, setSelectedProjectId] = useState(defaultValues?.projectId ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState(defaultValues?.taskId ?? "");

  const availableTasks = filterTasksByProject(tasks, selectedProjectId || null);

  function handleProjectChange(newProjectId: string) {
    setSelectedProjectId(newProjectId);
    if (selectedTaskId && !isTaskValidForProject(tasks, selectedTaskId, newProjectId || null)) {
      setSelectedTaskId("");
    }
  }

  return (
    <form action={formAction} className="space-y-4">
      {canSelectMember ? (
        <FormField label="Team member" htmlFor="userId" required error={state.fieldErrors?.userId}>
          <Select id="userId" name="userId" defaultValue={defaultValues?.userId ?? actorId} required aria-invalid={!!state.fieldErrors?.userId}>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : (
        <input type="hidden" name="userId" value={actorId} />
      )}

      <FormField label="Work date" htmlFor="workDate" required error={state.fieldErrors?.workDate}>
        <Input
          id="workDate"
          name="workDate"
          type="date"
          defaultValue={defaultValues?.workDate}
          required
          aria-invalid={!!state.fieldErrors?.workDate}
        />
      </FormField>

      <FormField label="Project" htmlFor="projectId" required error={state.fieldErrors?.projectId}>
        <Select
          id="projectId"
          name="projectId"
          value={selectedProjectId}
          onChange={(event) => handleProjectChange(event.target.value)}
          required
          aria-invalid={!!state.fieldErrors?.projectId}
        >
          <option value="">Select a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Task" htmlFor="taskId" error={state.fieldErrors?.taskId}>
        <Select
          id="taskId"
          name="taskId"
          value={selectedTaskId}
          onChange={(event) => setSelectedTaskId(event.target.value)}
          disabled={availableTasks.length === 0}
          aria-invalid={!!state.fieldErrors?.taskId}
        >
          <option value="">No task</option>
          {availableTasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </Select>
        {selectedProjectId && availableTasks.length === 0 && (
          <p className="text-text-muted mt-1 text-xs">This project has no tasks yet.</p>
        )}
      </FormField>

      <div>
        <FormLabel htmlFor="hours" required>
          Duration
        </FormLabel>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Input
              id="hours"
              name="hours"
              type="number"
              inputMode="numeric"
              min={0}
              max={24}
              step={1}
              defaultValue={defaultValues?.hours ?? 0}
              required
              className="w-20"
              aria-label="Hours"
              aria-invalid={!!state.fieldErrors?.durationMinutes}
            />
            <span className="text-text-secondary text-sm">h</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              id="minutes"
              name="minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              step={1}
              defaultValue={defaultValues?.minutes ?? 0}
              required
              className="w-20"
              aria-label="Minutes"
              aria-invalid={!!state.fieldErrors?.durationMinutes}
            />
            <span className="text-text-secondary text-sm">m</span>
          </div>
        </div>
        {state.fieldErrors?.durationMinutes && (
          <p role="alert" className="text-danger mt-1 text-sm">
            {state.fieldErrors.durationMinutes}
          </p>
        )}
      </div>

      <FormField label="Description" htmlFor="description" error={state.fieldErrors?.description}>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={defaultValues?.description ?? ""}
          maxLength={TIME_ENTRY_DESCRIPTION_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.description}
        />
      </FormField>

      <div className="flex items-center gap-2">
        <input
          id="billable"
          name="billable"
          type="checkbox"
          defaultChecked={defaultValues?.billable ?? true}
          className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        />
        <label htmlFor="billable" className="text-text-secondary text-sm">
          Billable
        </label>
      </div>

      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="submit" loading={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
