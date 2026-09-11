"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import {
  createLeadCaptureForm,
  updateLeadCaptureForm,
  setLeadCaptureFormActive,
  archiveLeadCaptureForm,
  unarchiveLeadCaptureForm,
} from "@/lib/lead-capture-forms/forms";
import { withToast } from "@/lib/toast-url";
import type { LeadCaptureFormMetadataFormState } from "@/types";

/**
 * Public Lead Capture Forms Phase 2A — the Server Action layer binding
 * src/lib/lead-capture-forms/forms.ts's own Phase 1 domain functions to
 * this Settings section's forms/buttons. Byte-for-byte mirror of
 * settings/custom-statuses/actions.ts's own header comment: any OWNER/
 * ADMIN/MEMBER of the organization may manage Lead Capture Forms — no
 * extra role gate, matching this app's existing Client-management
 * permission model. Every action re-derives organizationId itself via
 * getCurrentUserOrganization() — never trusts a client-supplied value —
 * and every domain-layer call already re-validates form ownership (see
 * forms.ts's own security comments), so a crafted id can never reach
 * another organization's data.
 *
 * None of this rewrites or redesigns the Phase 1 domain layer — every
 * mutation here is a plain call into an existing forms.ts export. The one
 * addition Phase 2A makes is at the boundary, not the domain: fields.ts's
 * validateLeadCaptureFormFieldsConfigInput itself gained one new rule
 * (hidden fields can't be required) — a small, additive validation
 * tightening, not a rewrite (see that file's own comment).
 */

const LIST_PATH = "/settings/lead-capture-forms";

function editPath(id: string): string {
  return `${LIST_PATH}/${id}`;
}

/** `null` return means "no fieldsConfig field was submitted at all" — every create/edit form always submits one, so this only happens for a hand-crafted request, in which case the domain layer's own default applies (same fail-open as every other optional field here). `undefined` signals "malformed JSON — reject outright" via the caller checking `parsed === undefined`. */
function parseFieldsConfigInput(formData: FormData): { ok: true; value: unknown } | { ok: false } {
  const raw = formData.get("fieldsConfig");
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

const INVALID_FIELDS_CONFIG_ERROR = "Something went wrong with the field configuration. Please reload and try again.";

export async function createLeadCaptureFormAction(
  _prevState: LeadCaptureFormMetadataFormState,
  formData: FormData,
): Promise<LeadCaptureFormMetadataFormState> {
  const fieldsConfigParsed = parseFieldsConfigInput(formData);
  if (!fieldsConfigParsed.ok) {
    return { error: INVALID_FIELDS_CONFIG_ERROR };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await createLeadCaptureForm(organizationId, {
    name: formData.get("name"),
    title: formData.get("title"),
    description: formData.get("description"),
    successMessage: formData.get("successMessage"),
    fieldsConfig: fieldsConfigParsed.value,
  });

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: null, fieldErrors: result.fieldErrors };
    }
    // INVALID_FIELDS_CONFIG — genuinely unreachable through this form
    // (FieldsConfigEditor itself prevents every combination this rejects
    // before it can ever be submitted), but still handled explicitly
    // rather than assumed away, per this app's existing "the boundary
    // enforces it independently of what the UI does or doesn't offer"
    // convention.
    return { error: INVALID_FIELDS_CONFIG_ERROR };
  }

  // createLeadCaptureForm's own contract always creates isActive: true
  // (the schema's own @default(true)) — this second, explicit call is
  // what actually deactivates it when the "Active" checkbox was
  // unchecked, the same "always create in the default state, then a
  // second explicit call for the one non-default choice" pattern
  // createCustomStatusAction's own makeDefault handling already uses.
  if (formData.get("isActive") !== "on") {
    await setLeadCaptureFormActive(organizationId, result.form.id, false);
  }

  revalidatePath(LIST_PATH);
  redirect(withToast(LIST_PATH, "Lead capture form created"));
}

export async function updateLeadCaptureFormAction(
  formId: string,
  _prevState: LeadCaptureFormMetadataFormState,
  formData: FormData,
): Promise<LeadCaptureFormMetadataFormState> {
  const fieldsConfigParsed = parseFieldsConfigInput(formData);
  if (!fieldsConfigParsed.ok) {
    return { error: INVALID_FIELDS_CONFIG_ERROR };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await updateLeadCaptureForm(organizationId, formId, {
    name: formData.get("name"),
    title: formData.get("title"),
    description: formData.get("description"),
    successMessage: formData.get("successMessage"),
    fieldsConfig: fieldsConfigParsed.value,
  });

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: null, fieldErrors: result.fieldErrors };
    }
    if (result.reason === "FORM_NOT_FOUND") {
      return { error: "Form not found." };
    }
    return { error: INVALID_FIELDS_CONFIG_ERROR };
  }

  const activeResult = await setLeadCaptureFormActive(organizationId, formId, formData.get("isActive") === "on");
  if (!activeResult.ok) {
    return { error: "Form not found." };
  }

  revalidatePath(LIST_PATH);
  revalidatePath(editPath(formId));
  redirect(withToast(LIST_PATH, "Lead capture form updated"));
}

export async function archiveLeadCaptureFormAction(formId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await archiveLeadCaptureForm(organizationId, formId);
  if (!result.ok) {
    throw new Error("Form not found.");
  }

  revalidatePath(LIST_PATH);
}

export async function unarchiveLeadCaptureFormAction(formId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await unarchiveLeadCaptureForm(organizationId, formId);
  if (!result.ok) {
    throw new Error("Form not found.");
  }

  revalidatePath(LIST_PATH);
}

/** Row-level quick toggle (list page) — same setLeadCaptureFormActive call the create/edit forms' own "Active" checkbox goes through, just without a metadata round trip. */
export async function setLeadCaptureFormActiveAction(formId: string, isActive: boolean): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await setLeadCaptureFormActive(organizationId, formId, isActive);
  if (!result.ok) {
    throw new Error("Form not found.");
  }

  revalidatePath(LIST_PATH);
}
