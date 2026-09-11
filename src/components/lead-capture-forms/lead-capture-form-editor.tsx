"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { FieldsConfigEditor } from "./fields-config-editor";
import {
  LEAD_CAPTURE_FORM_NAME_MAX_LENGTH,
  LEAD_CAPTURE_FORM_TITLE_MAX_LENGTH,
  LEAD_CAPTURE_FORM_DESCRIPTION_MAX_LENGTH,
  LEAD_CAPTURE_FORM_SUCCESS_MESSAGE_MAX_LENGTH,
} from "@/lib/validation/lead-capture-form";
import { defaultLeadCaptureFormFieldsConfig, type ResolvedLeadCaptureFormFieldsConfig } from "@/lib/lead-capture-forms/fields";
import type { LeadCaptureFormMetadataFormState } from "@/types";

const initialState: LeadCaptureFormMetadataFormState = { error: null };

type LeadCaptureFormDefaults = {
  name?: string;
  title?: string;
  description?: string | null;
  successMessage?: string | null;
  isActive?: boolean;
  fieldsConfig?: ResolvedLeadCaptureFormFieldsConfig;
};

/**
 * Public Lead Capture Forms Phase 2A — shared by
 * /settings/lead-capture-forms/new and /settings/lead-capture-forms/[id],
 * the same "one form component, an `action` prop, and a `defaultValues`
 * prop" convention LeadForm/ClientForm/ProjectForm already use. Submits
 * straight to createLeadCaptureFormAction/updateLeadCaptureFormAction
 * (src/app/(dashboard)/settings/lead-capture-forms/actions.ts) — those
 * are the only place any of this is validated or persisted; this
 * component only collects input and (for the Fields table) prevents the
 * one invalid combination it knows about before submit.
 */
export function LeadCaptureFormEditor({
  action,
  defaultValues,
  submitLabel = "Create form",
  pendingLabel = "Creating…",
}: {
  action: (prevState: LeadCaptureFormMetadataFormState, formData: FormData) => Promise<LeadCaptureFormMetadataFormState>;
  defaultValues?: LeadCaptureFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-4">
        <FormField label="Internal name" htmlFor="name" required error={state.fieldErrors?.name}>
          <Input
            id="name"
            name="name"
            defaultValue={defaultValues?.name}
            required
            maxLength={LEAD_CAPTURE_FORM_NAME_MAX_LENGTH}
            placeholder="e.g. Website contact form"
            aria-invalid={!!state.fieldErrors?.name}
          />
          <p className="text-text-muted mt-1 text-xs">Staff-facing only — never shown on the public form.</p>
        </FormField>

        <FormField label="Public title" htmlFor="title" required error={state.fieldErrors?.title}>
          <Input
            id="title"
            name="title"
            defaultValue={defaultValues?.title}
            required
            maxLength={LEAD_CAPTURE_FORM_TITLE_MAX_LENGTH}
            placeholder="e.g. Get in touch"
            aria-invalid={!!state.fieldErrors?.title}
          />
        </FormField>

        <FormField label="Description" htmlFor="description" error={state.fieldErrors?.description}>
          <Textarea
            id="description"
            name="description"
            defaultValue={defaultValues?.description ?? ""}
            rows={2}
            maxLength={LEAD_CAPTURE_FORM_DESCRIPTION_MAX_LENGTH}
            aria-invalid={!!state.fieldErrors?.description}
          />
        </FormField>

        <FormField label="Success message" htmlFor="successMessage" error={state.fieldErrors?.successMessage}>
          <Textarea
            id="successMessage"
            name="successMessage"
            defaultValue={defaultValues?.successMessage ?? ""}
            rows={2}
            maxLength={LEAD_CAPTURE_FORM_SUCCESS_MESSAGE_MAX_LENGTH}
            placeholder="Shown after a visitor submits the form."
            aria-invalid={!!state.fieldErrors?.successMessage}
          />
        </FormField>

        <div className="flex items-center gap-2">
          <input
            id="isActive"
            name="isActive"
            type="checkbox"
            defaultChecked={defaultValues?.isActive ?? true}
            className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          />
          <label htmlFor="isActive" className="text-text-secondary text-sm">
            Active — accepts public submissions
          </label>
        </div>
      </div>

      <div>
        <h2 className="text-text-primary mb-2 text-sm font-semibold">Fields</h2>
        <FieldsConfigEditor defaultConfig={defaultValues?.fieldsConfig ?? defaultLeadCaptureFormFieldsConfig()} />
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
