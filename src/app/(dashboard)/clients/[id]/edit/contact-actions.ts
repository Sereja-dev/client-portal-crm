"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { parseClientContactForm } from "@/lib/validation/client-contact";
import {
  createClientContact,
  updateClientContact,
  archiveClientContact,
  unarchiveClientContact,
  setPrimaryClientContact,
} from "@/lib/clients/contacts";
import type { ClientContactFormState } from "@/types";

/**
 * Multiple Contacts Phase 2 (Staff UI) — the Server Action layer binding
 * src/lib/clients/contacts.ts's own domain functions to this Client edit
 * page's forms/buttons. Every action here follows Client edit's own
 * existing permission model exactly (see updateClientAction in the
 * sibling actions.ts): any OWNER/ADMIN/MEMBER of the organization may
 * manage a Client's contacts — no extra role gate, unlike the stricter
 * OWNER/ADMIN-only Portal-access section on this same page. Every action
 * re-derives organizationId itself via getCurrentUserOrganization() —
 * never trusts a client-supplied value — and every domain-layer call
 * already re-validates the contact/Client actually belongs to that
 * organization (see contacts.ts's own security comments), so a crafted
 * contactId/clientId can never reach another organization's data.
 */

export async function createContactAction(
  clientId: string,
  _prevState: ClientContactFormState,
  formData: FormData,
): Promise<ClientContactFormState> {
  const { values, fieldErrors } = parseClientContactForm(formData);

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await createClientContact(organizationId, clientId, {
    name: values.name,
    email: values.email,
    phone: values.phone,
    role: values.role,
    isBilling: values.isBilling,
    isPrimary: values.isPrimary,
  });

  if (!result.ok) {
    if (result.reason === "CLIENT_NOT_FOUND") {
      return { error: "Client not found." };
    }
    // CONCURRENT_PRIMARY_CHANGE — a genuinely rare race (someone else set
    // a different primary between this form loading and submitting).
    return { error: "Could not save this contact. Please try again." };
  }

  revalidatePath(`/clients/${clientId}/edit`);
  return { error: null };
}

/**
 * Editable fields only: name/email/phone/role/isBilling. isPrimary is
 * deliberately never read from `formData` here — the Edit form has no
 * primary checkbox at all (see ContactForm's own comment) — primary can
 * only ever change through setPrimaryContactAction below, the one
 * dedicated, transactional code path for it (Phase 1 Section H/Phase 2
 * Section F/G).
 */
export async function updateContactAction(
  contactId: string,
  clientId: string,
  _prevState: ClientContactFormState,
  formData: FormData,
): Promise<ClientContactFormState> {
  const { values, fieldErrors } = parseClientContactForm(formData);

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { organizationId } = await getCurrentUserOrganization();

  const result = await updateClientContact(organizationId, contactId, {
    name: values.name,
    email: values.email,
    phone: values.phone,
    role: values.role,
    isBilling: values.isBilling,
  });

  if (!result.ok) {
    return { error: "Contact not found." };
  }

  revalidatePath(`/clients/${clientId}/edit`);
  return { error: null };
}

export async function archiveContactAction(contactId: string, clientId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await archiveClientContact(organizationId, contactId);
  if (!result.ok) {
    throw new Error("Contact not found.");
  }

  revalidatePath(`/clients/${clientId}/edit`);
}

export async function unarchiveContactAction(contactId: string, clientId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await unarchiveClientContact(organizationId, contactId);
  if (!result.ok) {
    throw new Error("Contact not found.");
  }

  revalidatePath(`/clients/${clientId}/edit`);
}

export async function setPrimaryContactAction(clientId: string, contactId: string): Promise<void> {
  const { organizationId } = await getCurrentUserOrganization();

  const result = await setPrimaryClientContact(organizationId, clientId, contactId);
  if (!result.ok) {
    throw new Error(
      result.reason === "ARCHIVED_CONTACT"
        ? "An archived contact can't be set as primary."
        : "Contact not found.",
    );
  }

  revalidatePath(`/clients/${clientId}/edit`);
}
