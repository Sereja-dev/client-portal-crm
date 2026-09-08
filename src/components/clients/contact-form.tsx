"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import {
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  CONTACT_ROLE_MAX_LENGTH,
} from "@/lib/validation/client-contact";
import type { ClientContactFormState } from "@/types";

const initialState: ClientContactFormState = { error: null };

export type ContactFormDefaults = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isBilling?: boolean;
};

/**
 * Multiple Contacts Phase 2 (Staff UI). Shared by both Add and Edit —
 * `mode` controls the one real structural difference between them: Add
 * shows a Primary checkbox (a brand-new contact may optionally be created
 * as primary, going through createContactAction's own createClientContact
 * call); Edit never shows one at all. This is a deliberate product
 * decision (Section F): editing a contact's other fields must never be
 * how primary status changes — that only ever happens through the
 * dedicated "Set primary" action elsewhere on the page (one explicit,
 * transactional code path, not two ways to reach the same state). An
 * already-primary contact's status is shown as a plain, non-interactive
 * label instead, so Edit never implies a primary contact could be
 * demoted by unchecking a box here.
 *
 * Every field id is generated via useId() rather than a static literal —
 * one Add dialog plus one Edit dialog per contact row are all mounted in
 * the DOM simultaneously (a closed native <dialog> is still present, just
 * not open), so with more than one contact a static id would collide
 * across instances: duplicate ids, invalid HTML, and a <label for=...>
 * that resolves to the wrong (or an ambiguous) input. Found live via this
 * component's own e2e coverage (client-contacts.spec.ts) once a second
 * contact made the collision actually reachable.
 */
export function ContactForm({
  mode,
  action,
  defaultValues,
  isPrimaryContact = false,
  onSuccess,
}: {
  mode: "add" | "edit";
  action: (
    prevState: ClientContactFormState,
    formData: FormData,
  ) => Promise<ClientContactFormState>;
  defaultValues?: ContactFormDefaults;
  /** Edit mode only — whether the contact being edited is the current active primary. */
  isPrimaryContact?: boolean;
  /** Called after a successful submit (error === null) — closes the dialog. */
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (prevState: ClientContactFormState, formData: FormData) => {
    const result = await action(prevState, formData);
    if (result.error === null && !result.fieldErrors) {
      onSuccess?.();
    }
    return result;
  }, initialState);

  const uid = useId();
  const nameId = `${uid}-name`;
  const emailId = `${uid}-email`;
  const phoneId = `${uid}-phone`;
  const roleId = `${uid}-role`;
  const isBillingId = `${uid}-isBilling`;
  const isPrimaryId = `${uid}-isPrimary`;

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="Name" htmlFor={nameId} required error={state.fieldErrors?.name}>
        <Input
          id={nameId}
          name="name"
          defaultValue={defaultValues?.name}
          required
          maxLength={CONTACT_NAME_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.name}
          aria-describedby={state.fieldErrors?.name ? `${nameId}-error` : undefined}
        />
      </FormField>

      <FormField label="Email" htmlFor={emailId} error={state.fieldErrors?.email}>
        <Input
          id={emailId}
          name="email"
          type="email"
          defaultValue={defaultValues?.email ?? ""}
          maxLength={CONTACT_EMAIL_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.email}
          aria-describedby={state.fieldErrors?.email ? `${emailId}-error` : undefined}
        />
      </FormField>

      <FormField label="Phone" htmlFor={phoneId} error={state.fieldErrors?.phone}>
        <Input
          id={phoneId}
          name="phone"
          type="tel"
          defaultValue={defaultValues?.phone ?? ""}
          maxLength={CONTACT_PHONE_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.phone}
          aria-describedby={state.fieldErrors?.phone ? `${phoneId}-error` : undefined}
        />
      </FormField>

      <FormField label="Role" htmlFor={roleId} error={state.fieldErrors?.role}>
        <Input
          id={roleId}
          name="role"
          placeholder="e.g. Owner, Billing contact"
          defaultValue={defaultValues?.role ?? ""}
          maxLength={CONTACT_ROLE_MAX_LENGTH}
          aria-invalid={!!state.fieldErrors?.role}
          aria-describedby={state.fieldErrors?.role ? `${roleId}-error` : undefined}
        />
      </FormField>

      <div className="flex items-center gap-2">
        <input
          id={isBillingId}
          name="isBilling"
          type="checkbox"
          defaultChecked={defaultValues?.isBilling}
          className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        />
        <label htmlFor={isBillingId} className="text-text-secondary text-sm">
          Billing contact
        </label>
      </div>

      {mode === "add" ? (
        <div className="flex items-center gap-2">
          <input
            id={isPrimaryId}
            name="isPrimary"
            type="checkbox"
            className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          />
          <label htmlFor={isPrimaryId} className="text-text-secondary text-sm">
            Make this the primary contact
          </label>
        </div>
      ) : (
        isPrimaryContact && (
          <p className="text-text-muted text-sm">
            This is the primary contact. To change who&apos;s primary, use{" "}
            <span className="text-text-primary font-medium">Set primary</span> on another
            contact instead.
          </p>
        )
      )}

      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="submit" loading={pending}>
          {pending ? "Saving…" : mode === "add" ? "Add contact" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
