"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/validation/task";
import type { TaskFormState } from "@/types";

const initialState: TaskFormState = { error: null };

type TaskFormDefaults = {
  title?: string;
  description?: string;
  projectId?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  assigneeId?: string;
};

export function TaskForm({
  action,
  projects,
  assignees,
  defaultValues,
  returnTo,
  submitLabel = "Create task",
  pendingLabel = "Creating…",
}: {
  action: (
    prevState: TaskFormState,
    formData: FormData,
  ) => Promise<TaskFormState>;
  projects: { id: string; label: string }[];
  /** Work Hub V1 — same-organization Staff members only, mirrors LeadForm's own `assignees` prop exactly. Always offered, for every role — assignment is a convenience field, not a permission (see tasks/query.ts's own TaskListParams doc comment). */
  assignees: { id: string; name: string }[];
  defaultValues?: TaskFormDefaults;
  /** Explicit navigation context, never a URL: only the literal "project" (Project Hub origin) is ever emitted; the server re-verifies the project. */
  returnTo?: "project";
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  // After a REJECTED submit React 19 natively resets the form to each field's
  // defaultValue, so the just-attempted values (state.values) must become the
  // defaults — otherwise every edit reverts to the URL/persisted defaults. The
  // selects are also keyed by their effective default so a changed selection
  // is re-mounted onto the right option. `undefined` (initial render, edit
  // mode, success) falls back to the normal defaults.
  const submitted = state.values;
  const initial = {
    title: submitted?.title ?? defaultValues?.title,
    description: submitted?.description ?? defaultValues?.description ?? "",
    projectId: submitted?.projectId ?? defaultValues?.projectId ?? "",
    status: submitted?.status ?? defaultValues?.status ?? "TODO",
    priority: submitted?.priority ?? defaultValues?.priority ?? "MEDIUM",
    dueDate: submitted?.dueDate ?? defaultValues?.dueDate ?? "",
    assigneeId: submitted?.assigneeId ?? defaultValues?.assigneeId ?? "",
  };

  return (
    <form action={formAction} className="space-y-4">
      {returnTo === "project" && <input type="hidden" name="returnTo" value="project" />}
      <FormField label="Title" htmlFor="title" required error={state.fieldErrors?.title}>
        <Input
          id="title"
          name="title"
          defaultValue={initial.title}
          required
          aria-invalid={!!state.fieldErrors?.title}
          aria-describedby={state.fieldErrors?.title ? "title-error" : undefined}
        />
      </FormField>

      <FormField label="Description" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial.description}
        />
      </FormField>

      <FormField
        label="Project"
        htmlFor="projectId"
        required
        error={state.fieldErrors?.projectId}
      >
        <Select
          key={initial.projectId}
          id="projectId"
          name="projectId"
          defaultValue={initial.projectId}
          required
          aria-invalid={!!state.fieldErrors?.projectId}
          aria-describedby={
            state.fieldErrors?.projectId ? "projectId-error" : undefined
          }
        >
          <option value="" disabled>
            Select a project
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.label}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Status" htmlFor="status" error={state.fieldErrors?.status}>
          <Select
            key={initial.status}
            id="status"
            name="status"
            defaultValue={initial.status}
            aria-invalid={!!state.fieldErrors?.status}
            aria-describedby={
              state.fieldErrors?.status ? "status-error" : undefined
            }
          >
            {TASK_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Priority"
          htmlFor="priority"
          error={state.fieldErrors?.priority}
        >
          <Select
            key={initial.priority}
            id="priority"
            name="priority"
            defaultValue={initial.priority}
            aria-invalid={!!state.fieldErrors?.priority}
            aria-describedby={
              state.fieldErrors?.priority ? "priority-error" : undefined
            }
          >
            {TASK_PRIORITIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Due date"
          htmlFor="dueDate"
          error={state.fieldErrors?.dueDate}
        >
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={initial.dueDate}
            aria-invalid={!!state.fieldErrors?.dueDate}
            aria-describedby={
              state.fieldErrors?.dueDate ? "dueDate-error" : undefined
            }
          />
        </FormField>

        <FormField label="Assignee" htmlFor="assigneeId" error={state.fieldErrors?.assigneeId}>
          <Select
            key={initial.assigneeId}
            id="assigneeId"
            name="assigneeId"
            defaultValue={initial.assigneeId}
            aria-invalid={!!state.fieldErrors?.assigneeId}
            aria-describedby={state.fieldErrors?.assigneeId ? "assigneeId-error" : undefined}
          >
            <option value="">Unassigned</option>
            {assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
