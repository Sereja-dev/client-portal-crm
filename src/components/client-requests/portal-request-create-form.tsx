"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { formatStatusLabel } from "@/lib/format";
import {
  CLIENT_REQUEST_TITLE_MAX_LENGTH,
  CLIENT_REQUEST_DESCRIPTION_MAX_LENGTH,
  PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES,
} from "@/lib/validation/client-request";
import type { ClientRequestCreateFormState } from "@/types";

const initialState: ClientRequestCreateFormState = { error: null };

/**
 * Client Requests / Tickets Phase 2A — Portal "New request" form. Only
 * ever offers LOW/NORMAL/HIGH (PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES,
 * the exact same Phase 1 constant createPortalClientRequestAction's own
 * server-side validation uses) — URGENT is never rendered as an option
 * here at all, so there is nothing to submit even before the server-side
 * restriction would reject it. `projects` is pre-filtered server-side
 * (getPortalProjects(clientId) — this Portal Client's own Projects only)
 * by the page component; this form never fetches or filters anything
 * itself.
 */
export function PortalRequestCreateForm({
  action,
  projects,
}: {
  action: (prevState: ClientRequestCreateFormState, formData: FormData) => Promise<ClientRequestCreateFormState>;
  projects: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="Title" htmlFor="title" required error={state.fieldErrors?.title}>
        <Input id="title" name="title" required maxLength={CLIENT_REQUEST_TITLE_MAX_LENGTH} aria-invalid={!!state.fieldErrors?.title} />
      </FormField>

      <FormField label="Description" htmlFor="description" required error={state.fieldErrors?.description}>
        <Textarea
          id="description"
          name="description"
          rows={5}
          required
          maxLength={CLIENT_REQUEST_DESCRIPTION_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.description}
        />
      </FormField>

      {projects.length > 0 && (
        <FormField label="Project" htmlFor="projectId">
          <Select id="projectId" name="projectId" defaultValue="">
            <option value="">None</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      <FormField label="Priority" htmlFor="priority" error={state.fieldErrors?.priority}>
        <Select id="priority" name="priority" defaultValue="NORMAL" aria-invalid={!!state.fieldErrors?.priority}>
          {PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {formatStatusLabel(priority)}
            </option>
          ))}
        </Select>
      </FormField>

      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" loading={pending}>
        {pending ? "Submitting…" : "Submit request"}
      </Button>
    </form>
  );
}
