"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { formatStatusLabel } from "@/lib/format";
import {
  LEAD_SOURCES,
  LEAD_NAME_MAX_LENGTH,
  LEAD_COMPANY_MAX_LENGTH,
  LEAD_EMAIL_MAX_LENGTH,
  LEAD_PHONE_MAX_LENGTH,
  LEAD_NOTES_MAX_LENGTH,
} from "@/lib/validation/lead";
import {
  CustomFieldsFormSection,
  type CustomFieldFormDefinitionForUI,
  type CustomFieldFormValueForUI,
} from "@/components/custom-fields/custom-fields-form-section";
import type { LeadFormState } from "@/types";

const initialState: LeadFormState = { error: null };

type LeadFormDefaults = {
  name?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  value?: string | number | null;
  notes?: string | null;
  assignedToUserId?: string | null;
};

/**
 * Shared by /leads/new and /leads/[id]/edit — mirrors ClientForm/
 * ProjectForm's exact structure and conventions (useActionState,
 * FormField/Input/Select, the same error-display pattern). No stage
 * field here at all: createLeadAction always starts a new Lead at NEW
 * (no arbitrary initial-stage input is accepted server-side), and
 * updateLeadAction never touches stage either — that's LeadStagePanel's
 * own job on the edit page (moveLeadStageAction/markLeadLostAction),
 * never folded into this generic create/edit form.
 */
export function LeadForm({
  action,
  assignees,
  defaultValues,
  customFieldDefinitions = [],
  customFieldValues = {},
  submitLabel = "Create lead",
  pendingLabel = "Creating…",
}: {
  action: (prevState: LeadFormState, formData: FormData) => Promise<LeadFormState>;
  /** Active same-organization Staff members only — resolved server-side by the calling page via Membership, never client-supplied. */
  assignees: { id: string; name: string }[];
  defaultValues?: LeadFormDefaults;
  /** Custom Fields Phase 2B (Section B) — active LEAD definitions only. */
  customFieldDefinitions?: CustomFieldFormDefinitionForUI[];
  /** Edit only — this Lead's own current values, keyed by definitionId. */
  customFieldValues?: Record<string, CustomFieldFormValueForUI>;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="Name" htmlFor="name" required error={state.fieldErrors?.name}>
        <Input
          id="name"
          name="name"
          defaultValue={defaultValues?.name}
          required
          maxLength={LEAD_NAME_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.name}
          aria-describedby={state.fieldErrors?.name ? "name-error" : undefined}
        />
      </FormField>

      <FormField label="Company" htmlFor="company" error={state.fieldErrors?.company}>
        <Input
          id="company"
          name="company"
          defaultValue={defaultValues?.company ?? ""}
          maxLength={LEAD_COMPANY_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.company}
          aria-describedby={state.fieldErrors?.company ? "company-error" : undefined}
        />
      </FormField>

      <FormField label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={defaultValues?.email ?? ""}
          maxLength={LEAD_EMAIL_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.email}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
      </FormField>

      <FormField label="Phone" htmlFor="phone" error={state.fieldErrors?.phone}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={defaultValues?.phone ?? ""}
          maxLength={LEAD_PHONE_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.phone}
          aria-describedby={state.fieldErrors?.phone ? "phone-error" : undefined}
        />
      </FormField>

      <FormField label="Source" htmlFor="source" error={state.fieldErrors?.source}>
        <Select
          id="source"
          name="source"
          defaultValue={defaultValues?.source ?? ""}
          aria-invalid={!!state.fieldErrors?.source}
          aria-describedby={state.fieldErrors?.source ? "source-error" : undefined}
        >
          <option value="">Unknown</option>
          {LEAD_SOURCES.map((source) => (
            <option key={source} value={source}>
              {formatStatusLabel(source)}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Estimated value" htmlFor="value" error={state.fieldErrors?.value}>
        <Input
          id="value"
          name="value"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          defaultValue={defaultValues?.value != null ? String(defaultValues.value) : ""}
          aria-invalid={!!state.fieldErrors?.value}
          aria-describedby={state.fieldErrors?.value ? "value-error" : undefined}
        />
      </FormField>

      <FormField label="Assignee" htmlFor="assignedToUserId" error={state.fieldErrors?.assignedToUserId}>
        <Select
          id="assignedToUserId"
          name="assignedToUserId"
          defaultValue={defaultValues?.assignedToUserId ?? ""}
          aria-invalid={!!state.fieldErrors?.assignedToUserId}
          aria-describedby={state.fieldErrors?.assignedToUserId ? "assignedToUserId-error" : undefined}
        >
          <option value="">Unassigned</option>
          {assignees.map((assignee) => (
            <option key={assignee.id} value={assignee.id}>
              {assignee.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Notes" htmlFor="notes" error={state.fieldErrors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={defaultValues?.notes ?? ""}
          maxLength={LEAD_NOTES_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.notes}
          aria-describedby={state.fieldErrors?.notes ? "notes-error" : undefined}
        />
      </FormField>

      <CustomFieldsFormSection
        definitions={customFieldDefinitions}
        values={customFieldValues}
        errors={state.customFieldErrors}
      />

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
