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
import { resolveStatusForSave } from "@/lib/custom-statuses/entity-form";
import type { ClientStatusValue } from "@/lib/validation/client";
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

    // Custom Statuses Phase 2B (Section L/R) — statusDefinitionId is the
    // real, Staff-selected status identity, re-resolved and re-verified
    // on every update (never trusted off FormData directly).
    // `existing.statusDefinitionId` is passed as the "current" exemption
    // — an archived status the Client already has is rejected here ONLY
    // if the Staff member tried to change it to something ELSE that's
    // also archived; submitting the form unchanged (still pointing at
    // its own current archived status) is always allowed (Section L:
    // "allow user to keep it").
    const statusResult = await resolveStatusForSave(
      organizationId,
      "CLIENT",
      values.statusDefinitionId,
      existing.statusDefinitionId,
      tx,
    );
    if (!statusResult.ok) {
      return statusResult.reason === "ARCHIVED" ? ("status_archived" as const) : ("status_not_found" as const);
    }

    // Section H/assignment.ts's own established compatibility rule: a
    // SYSTEM target keeps the legacy enum in sync; a CUSTOM target
    // leaves it completely untouched (Prisma `undefined` = no-op) —
    // whether newly assigned or simply re-submitted unchanged, exactly
    // like assignClientStatus's own documented behavior.
    const legacyStatus: ClientStatusValue | undefined = statusResult.isSystem
      ? (statusResult.key.toUpperCase() as ClientStatusValue)
      : undefined;

    const result = await tx.client.updateMany({
      where: { id: clientId, organizationId },
      data: { ...values, status: legacyStatus, statusDefinitionId: statusResult.definitionId },
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
    // `values.status` from parseClientForm is never real anymore (the
    // form no longer submits a `status` field at all — see this file's
    // own comment above) — substituted here with the actual computed
    // legacy value (falling back to the row's own existing value for a
    // CUSTOM target, whose legacy column was left untouched) so the diff
    // and Activity metadata both describe what genuinely changed, never
    // a false "status changed to LEAD" for every unrelated edit.
    const valuesForActivity = { ...values, status: legacyStatus ?? existing.status };
    const changedFields = diffClientFields(existing, valuesForActivity);
    if (changedFields.length > 0) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "CLIENT",
        entityId: clientId,
        action: "UPDATED",
        metadata: buildClientActivityMetadata(valuesForActivity, user.name, changedFields),
      });
    }

    return "updated" as const;
  });

  if (outcome === "not_found") {
    return { error: "This client could not be found." };
  }
  if (outcome === "status_not_found" || outcome === "status_archived") {
    return {
      error: null,
      fieldErrors: {
        statusDefinitionId:
          outcome === "status_archived" ? "This status is archived and can't be assigned." : "Select a valid status.",
      },
    };
  }

  redirect(withToast("/clients", "Client updated"));
}
