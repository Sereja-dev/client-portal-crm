"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { submitLeadCaptureFormAction, type LeadCaptureSubmissionState } from "@/app/forms/[token]/actions";
import type { PublicLeadCaptureFormField } from "@/lib/lead-capture-forms/fields";

const initialState: LeadCaptureSubmissionState = { error: null };

const INPUT_TYPE: Partial<Record<PublicLeadCaptureFormField["key"], string>> = {
  email: "email",
  phone: "tel",
};

export function PublicLeadCaptureForm({
  token,
  fields,
  successMessage,
}: {
  token: string;
  fields: PublicLeadCaptureFormField[];
  successMessage: string | null;
}) {
  const [state, formAction, pending] = useActionState(submitLeadCaptureFormAction.bind(null, token), initialState);

  if (state.success) {
    return (
      <p role="status" className="text-sm text-gray-700">
        {successMessage ?? "Thanks — we've received your submission."}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {fields.map((field) =>
        field.key === "message" ? (
          <FormField key={field.key} label={field.label} htmlFor={field.key} required={field.required} error={state.fieldErrors?.[field.key]}>
            <Textarea id={field.key} name={field.key} required={field.required} rows={4} aria-invalid={Boolean(state.fieldErrors?.[field.key])} />
          </FormField>
        ) : (
          <FormField key={field.key} label={field.label} htmlFor={field.key} required={field.required} error={state.fieldErrors?.[field.key]}>
            <Input
              id={field.key}
              name={field.key}
              type={INPUT_TYPE[field.key] ?? "text"}
              required={field.required}
              aria-invalid={Boolean(state.fieldErrors?.[field.key])}
            />
          </FormField>
        ),
      )}

      {/* Honeypot — invisible to a real visitor (off-screen, never
          tab-reachable, no visible label), and never named "company"/
          "website" the way the real field above might be labeled, so a
          bot filling every field it can see never touches this one by
          accident. A populated value here is silently discarded server
          side (see submitLeadCaptureFormAction) with no distinguishable
          response. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
