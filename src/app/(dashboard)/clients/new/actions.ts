"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { parseClientForm } from "@/lib/validation/client";
import { withToast } from "@/lib/toast-url";
import { createActivity } from "@/lib/activity/create-activity";
import { dispatchWorkflowAutomations } from "@/lib/workflow-automations/dispatch";
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
import {
  getActiveTagFormOptions,
  parseTagFormSelection,
  persistTagAssignmentsInTransaction,
} from "@/lib/tags/entity-form";
import { resolveStatusForSave } from "@/lib/custom-statuses/entity-form";
import type { ClientStatusValue } from "@/lib/validation/client";
import type { ClientFormState } from "@/types";

/** Thrown only inside createClientAction's own transaction, to carry a typed rejection reason out to its catch block — never allowed to escape this function (Section R). */
class ClientStatusResolutionError extends Error {
  constructor(readonly reason: "NOT_FOUND" | "ARCHIVED") {
    super(`Client status resolution rejected: ${reason}`);
  }
}

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

  // Tags V2 (Section 3/6) — every submitted `tagIds` value is filtered
  // down to only ids among this organization's own ACTIVE tags, loaded
  // fresh right here (never trusts the FormData for which tags exist or
  // are still active) — see parseTagFormSelection's own comment.
  const tagOptions = await getActiveTagFormOptions(organizationId);
  const submittedTagIds = parseTagFormSelection(formData, tagOptions);

  let clientActivity: Awaited<ReturnType<typeof createActivity>> | undefined;

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

      // Custom Statuses Phase 2B (Section L/R) — statusDefinitionId is
      // now the real, Staff-selected status identity (never trusted
      // directly off FormData: re-fetched by {id, organizationId,
      // entityType}, which also rejects a foreign-org/wrong-entityType/
      // archived id). A brand-new Client has no "current" definition to
      // exempt (currentDefinitionId: null), so an archived target is
      // always rejected here, with no exception.
      const statusResult = await resolveStatusForSave(organizationId, "CLIENT", values.statusDefinitionId, null, tx);
      if (!statusResult.ok) {
        throw new ClientStatusResolutionError(statusResult.reason);
      }

      // Section H's own documented compatibility rule: a SYSTEM target
      // writes its own matching legacy enum value (system keys are
      // always the lowercase of their legacy enum, e.g. "active" ->
      // "ACTIVE"); a CUSTOM target has no legacy representation at all,
      // so the legacy NOT NULL column falls back to this exact same
      // "LEAD" value parseClientForm's own field parser has always
      // defaulted to when no status was specified — the pre-existing
      // schema-level default, not an invented neutral value (Section H:
      // "Do NOT invent a fake neutral enum"). This legacy value is never
      // read as authoritative by any display/filter/KPI once a real
      // statusDefinitionId is present (Phase 2A's own read migration).
      const legacyStatus: ClientStatusValue = statusResult.isSystem
        ? (statusResult.key.toUpperCase() as ClientStatusValue)
        : "LEAD";

      const client = await tx.client.create({
        data: {
          ...values,
          status: legacyStatus,
          statusDefinitionId: statusResult.definitionId,
          userId: user.id,
          organizationId,
        },
      });

      await persistCustomFieldValuesInTransaction(tx, {
        organizationId,
        entityType: "CLIENT",
        entityId: client.id,
        definitions: customFieldDefinitions,
        rawValues: rawCustomFieldValues,
        decisions: customFieldValidation.decisions,
      });

      // Tags V2 (Section 3) — a brand-new Client has no pre-existing
      // assignments to diff against.
      await persistTagAssignmentsInTransaction(tx, {
        organizationId,
        entityType: "CLIENT",
        entityId: client.id,
        existingActiveTagIds: [],
        submittedTagIds,
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

      clientActivity = await createActivity(tx, {
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
    if (err instanceof ClientStatusResolutionError) {
      return {
        error: null,
        fieldErrors: {
          statusDefinitionId:
            err.reason === "ARCHIVED" ? "This status is archived and can't be assigned." : "Select a valid status.",
        },
      };
    }
    throw err;
  }

  // Post-commit, best-effort — see dispatchWorkflowAutomations's own
  // non-throwing contract. clientActivity is always set here: the only
  // paths that reach this line without it are early `return`s above the
  // transaction (validation/duplicate-email) or a caught error that
  // itself returned — none of which fall through to this line.
  if (clientActivity) {
    await dispatchWorkflowAutomations(clientActivity);
  }

  redirect(withToast("/clients", "Client created"));
}
