"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { parseClientForm } from "@/lib/validation/client";
import { withToast } from "@/lib/toast-url";
import { dispatchWorkflowAutomations } from "@/lib/workflow-automations/dispatch";
import { BillingLimitError } from "@/lib/billing/enforcement";
import { findDuplicateOrganizationClientByEmail } from "@/lib/clients/duplicate-email";
import { createClientCore, ClientStatusResolutionError } from "@/lib/clients/create-core";
import { enqueueIntegrationDelivery } from "@/lib/integrations/enqueue";
import { deliverIntegrationEventBestEffort } from "@/lib/integrations/deliver";
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

  // Tags V2 (Section 3/6) — every submitted `tagIds` value is filtered
  // down to only ids among this organization's own ACTIVE tags, loaded
  // fresh right here (never trusts the FormData for which tags exist or
  // are still active) — see parseTagFormSelection's own comment.
  const tagOptions = await getActiveTagFormOptions(organizationId);
  const submittedTagIds = parseTagFormSelection(formData, tagOptions);

  let clientActivity: Awaited<ReturnType<typeof createClientCore>>["activity"] | undefined;
  let integrationDeliveryId: string | null = null;
  // The id of the Client this call actually persisted, captured inside the
  // transaction below (no extra query) so the success redirect can land on
  // the new Client Profile.
  let createdClientId: string | undefined;

  try {
    // Client create (via the shared createClientCore — see that
    // module's own doc comment for why this is factored out: import
    // reuses the exact same invariant-preserving core, just with
    // Activity creation suppressed), its custom field values, and its
    // Activity row are one atomic unit — if any of them fail, everything
    // rolls back together rather than leaving a Client with half-written
    // custom fields (Section E).
    await prisma.$transaction(async (tx) => {
      const { client, activity } = await createClientCore(tx, {
        organizationId,
        userId: user.id,
        actorName: user.name,
        context: "interactive",
        input: values,
        requestedStatusDefinitionId: values.statusDefinitionId,
      });
      clientActivity = activity;
      createdClientId = client.id;

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

      // Integrations V1 — CLIENT_CREATED.
      if (activity) {
        const enqueued = await enqueueIntegrationDelivery(tx, { organizationId, activity });
        integrationDeliveryId = enqueued?.deliveryId ?? null;
      }
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
  if (integrationDeliveryId) {
    await deliverIntegrationEventBestEffort(integrationDeliveryId);
  }

  // First-Time User Experience V2, Slice A: land on the new Client Profile,
  // whose primary "Create project" action (/projects/new?clientId=<id>)
  // is the natural next step — the same pattern Project creation already
  // follows (it lands on its Project Hub). Every ordinary Client creation
  // uses this action, so the behavior is consistent, not onboarding-only.
  // createdClientId is always set once the transaction above has committed;
  // the "/clients" fallback is defensive only and cannot be reached.
  redirect(withToast(createdClientId ? `/clients/${createdClientId}` : "/clients", "Client created"));
}
