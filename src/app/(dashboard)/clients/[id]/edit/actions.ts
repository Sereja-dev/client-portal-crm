"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { parseClientForm } from "@/lib/validation/client";
import { withToast } from "@/lib/toast-url";
import { createActivity } from "@/lib/activity/create-activity";
import { diffClientFields, buildClientActivityMetadata } from "@/lib/activity/client-metadata";
import { findDuplicateOrganizationClientByEmail } from "@/lib/clients/duplicate-email";
import { syncPrimaryContactEmailFromClientEdit } from "@/lib/clients/contacts";
import {
  getActiveCustomFieldFormDefinitions,
  getCustomFieldFormValues,
  parseCustomFieldFormValues,
  validateCustomFieldFormValues,
  persistCustomFieldValuesInTransaction,
} from "@/lib/custom-fields/entity-form";
import type { ClientFormState } from "@/types";

export async function updateClientAction(
  clientId: string,
  _prevState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const { values, fieldErrors } = parseClientForm(formData);

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  // Leads / Sales Pipeline Phase 2.2 — same-organization, case-insensitive
  // check, excluding this Client itself so keeping (or trivially
  // re-casing) your own unchanged email never self-conflicts. See
  // createClientAction's own identical comment for why this replaces a
  // database-level constraint rather than a P2002 catch.
  if (
    await findDuplicateOrganizationClientByEmail({
      organizationId,
      email: values.email,
      excludeClientId: clientId,
    })
  ) {
    return {
      error: null,
      fieldErrors: { email: "A client with this email already exists." },
    };
  }

  // Custom Fields Phase 2B (Section F/H/I/J/K) — only ACTIVE definitions
  // are ever loaded/parsed/enforced here; an archived definition's
  // existing value is simply never touched by this action at all (it's
  // absent from `customFieldDefinitions`, so parseCustomFieldFormValues
  // never even looks for its FormData key, and persistCustomFieldValuesInTransaction
  // only ever iterates the same active list) — Section H's "editing an
  // entity must NOT silently delete values belonging to archived
  // definitions" is satisfied structurally, not by an extra check.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "CLIENT");
  const existingCustomFieldValues = await getCustomFieldFormValues(
    organizationId,
    "CLIENT",
    clientId,
    customFieldDefinitions,
  );
  const rawCustomFieldValues = parseCustomFieldFormValues(formData, customFieldDefinitions);
  const customFieldValidation = validateCustomFieldFormValues(
    customFieldDefinitions,
    rawCustomFieldValues,
    existingCustomFieldValues,
  );
  if (!customFieldValidation.ok) {
    return { error: null, customFieldErrors: customFieldValidation.fieldErrors };
  }

  // Update and its (conditional) Activity row are one atomic unit — a
  // failed Activity insert rolls the update back too.
  const outcome = await prisma.$transaction(async (tx) => {
    // Scoped by id + organizationId together — a foreign org's client id
    // simply doesn't match, indistinguishable from a nonexistent one.
    // Also doubles as the "before" snapshot for change-detection below.
    const existing = await tx.client.findFirst({
      where: { id: clientId, organizationId },
    });

    if (!existing) {
      return "not_found" as const;
    }

    const result = await tx.client.updateMany({
      where: { id: clientId, organizationId },
      data: values,
    });

    if (result.count === 0) {
      return "not_found" as const;
    }

    await persistCustomFieldValuesInTransaction(tx, {
      organizationId,
      entityType: "CLIENT",
      entityId: clientId,
      definitions: customFieldDefinitions,
      rawValues: rawCustomFieldValues,
      decisions: customFieldValidation.decisions,
    });

    // Multiple Contacts Phase 1 — "Close Legacy Email Sync Gap." Only
    // when the email genuinely changed (never an unconditional write, so
    // an untouched-email re-save never mutates a contact for no reason)
    // — see syncPrimaryContactEmailFromClientEdit's own comment for the
    // full rule, including the deliberate "explicit clear also clears
    // the primary contact's email" choice. Same transaction as the
    // Client update above: if this throws, the whole update (Client row
    // included) rolls back with it.
    if (existing.email !== values.email) {
      await syncPrimaryContactEmailFromClientEdit(tx, organizationId, clientId, values.email);
    }

    // Only log a real change — a re-submit of identical values (e.g. an
    // accidental double-save) shouldn't add a no-op entry to the log.
    const changedFields = diffClientFields(existing, values);
    if (changedFields.length > 0) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "CLIENT",
        entityId: clientId,
        action: "UPDATED",
        metadata: buildClientActivityMetadata(values, user.name, changedFields),
      });
    }

    return "updated" as const;
  });

  if (outcome === "not_found") {
    return { error: "This client could not be found." };
  }

  redirect(withToast("/clients", "Client updated"));
}
