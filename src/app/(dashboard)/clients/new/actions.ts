"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { parseClientForm } from "@/lib/validation/client";
import { withToast } from "@/lib/toast-url";
import { createActivity } from "@/lib/activity/create-activity";
import { buildClientActivityMetadata } from "@/lib/activity/client-metadata";
import { assertCanCreateClient, BillingLimitError } from "@/lib/billing/enforcement";
import { findDuplicateOrganizationClientByEmail } from "@/lib/clients/duplicate-email";
import { createClientContact, resolveFallbackContactName } from "@/lib/clients/contacts";
import {
  getActiveCustomFieldFormDefinitions,
  parseCustomFieldFormValues,
  validateCustomFieldFormValues,
  persistCustomFieldValuesInTransaction,
} from "@/lib/custom-fields/entity-form";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import type { ClientFormState } from "@/types";

export async function createClientAction(
  _prevState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const { values, fieldErrors } = parseClientForm(formData);

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  // Leads / Sales Pipeline Phase 2.2 — Client no longer has any database-
  // level email-uniqueness constraint (see the Client Email Uniqueness
  // audit: it predated multi-tenancy and was never organization-scoped
  // to begin with). Manual Client creation is intentionally still
  // blocked on a same-organization duplicate — unlike Lead conversion's
  // own confirmDuplicate flow, there is no "create anyway" path here.
  if (await findDuplicateOrganizationClientByEmail({ organizationId, email: values.email })) {
    return {
      error: null,
      fieldErrors: { email: "A client with this email already exists." },
    };
  }

  // Custom Fields Phase 2B (Section E/J/K) — loaded fresh from the
  // database (never trusts formData for which definitions exist),
  // parsed only against those, and fully validated BEFORE the Client is
  // created: a required custom field left empty (or any other custom
  // field error) must never create the Client at all.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "CLIENT");
  const rawCustomFieldValues = parseCustomFieldFormValues(formData, customFieldDefinitions);
  const customFieldValidation = validateCustomFieldFormValues(customFieldDefinitions, rawCustomFieldValues);
  if (!customFieldValidation.ok) {
    return { error: null, customFieldErrors: customFieldValidation.fieldErrors };
  }

  try {
    // Client create, its custom field values, and its Activity row are
    // one atomic unit — if any of them fail, everything rolls back
    // together rather than leaving a Client with half-written custom
    // fields (Section E).
    await prisma.$transaction(async (tx) => {
      // Billing & Subscriptions Stage 2 — re-checked from inside this same
      // transaction (docs/billing-architecture.md §7's race handling),
      // immediately before the Client write it guards.
      await assertCanCreateClient(organizationId, tx);

      // Custom Statuses Phase 1 (Section P) — keeps the new, backfilled
      // statusDefinitionId identity in sync with the legacy `status`
      // enum this action already writes, for every organization that
      // has been bootstrapped with its system definitions (every
      // organization, per Section N — this lookup is only ever null if
      // that invariant is somehow violated, and creation must not be
      // blocked by that: `?.id` simply leaves the column unset).
      const statusDefinition = await resolveSystemStatusDefinition(
        organizationId,
        "CLIENT",
        values.status.toLowerCase(),
        tx,
      );

      const client = await tx.client.create({
        data: { ...values, userId: user.id, organizationId, statusDefinitionId: statusDefinition?.id },
      });

      await persistCustomFieldValuesInTransaction(tx, {
        organizationId,
        entityType: "CLIENT",
        entityId: client.id,
        definitions: customFieldDefinitions,
        rawValues: rawCustomFieldValues,
        decisions: customFieldValidation.decisions,
      });

      // Multiple Contacts Phase 1 — a Client created with contact-capable
      // fields (email and/or phone) gets one primary ClientContact in the
      // same transaction, so contact creation failing rolls the Client
      // create back with it. Client.name is never copied onto the
      // contact's own name — see resolveFallbackContactName's own comment
      // for why (same rule this feature's backfill migration uses).
      // Skipped entirely when neither is present, matching the backfill's
      // own "be conservative" trigger condition.
      if (values.email || values.phone) {
        const contactResult = await createClientContact(
          organizationId,
          client.id,
          {
            name: resolveFallbackContactName(values.email),
            email: values.email,
            phone: values.phone,
            isPrimary: true,
          },
          tx,
        );
        // CLIENT_NOT_FOUND/CONCURRENT_PRIMARY_CHANGE are both structurally
        // unreachable here (the Client was just created in this same
        // transaction with zero pre-existing contacts) — thrown rather
        // than silently ignored, so an unexpected failure rolls the whole
        // Client create back instead of committing a Client with a
        // silently-skipped contact.
        if (!contactResult.ok) {
          throw new Error(`Unexpected ClientContact creation failure: ${contactResult.reason}`);
        }
      }

      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "CLIENT",
        entityId: client.id,
        action: "CREATED",
        metadata: buildClientActivityMetadata(client, user.name),
      });
    });
  } catch (err) {
    if (err instanceof BillingLimitError) {
      return { error: err.message };
    }
    throw err;
  }

  redirect(withToast("/clients", "Client created"));
}
