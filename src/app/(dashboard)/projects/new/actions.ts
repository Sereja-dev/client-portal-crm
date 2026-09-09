"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { parseProjectForm } from "@/lib/validation/project";
import { withToast } from "@/lib/toast-url";
import { createActivity } from "@/lib/activity/create-activity";
import { buildProjectMetadata } from "@/lib/activity/project-metadata";
import { assertCanCreateProject, BillingLimitError } from "@/lib/billing/enforcement";
import {
  getActiveCustomFieldFormDefinitions,
  parseCustomFieldFormValues,
  validateCustomFieldFormValues,
  persistCustomFieldValuesInTransaction,
} from "@/lib/custom-fields/entity-form";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import type { ProjectFormState } from "@/types";

export async function createProjectAction(
  _prevState: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const { values, fieldErrors } = parseProjectForm(formData);

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  // The <select> only lists this org's clients, but the form value is
  // still client-controlled input — re-verify ownership server-side so a
  // tampered clientId can never attach a project to another org's client.
  const client = await prisma.client.findFirst({
    where: { id: values.clientId, organizationId },
    select: { id: true, name: true },
  });

  if (!client) {
    return {
      error: null,
      fieldErrors: { clientId: "Select a valid client." },
    };
  }

  // Custom Fields Phase 2B (Section E/J/K) — see createClientAction's
  // own identical comment.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "PROJECT");
  const rawCustomFieldValues = parseCustomFieldFormValues(formData, customFieldDefinitions);
  const customFieldValidation = validateCustomFieldFormValues(customFieldDefinitions, rawCustomFieldValues);
  if (!customFieldValidation.ok) {
    return { error: null, customFieldErrors: customFieldValidation.fieldErrors };
  }

  try {
    // Project create, its custom field values, and its Activity row are
    // one atomic unit — if any of them fail, everything rolls back
    // together rather than leaving a Project with half-written custom
    // fields (Section E).
    await prisma.$transaction(async (tx) => {
      // Billing & Subscriptions Stage 2 — re-checked from inside this same
      // transaction (docs/billing-architecture.md §7's race handling),
      // immediately before the Project write it guards.
      await assertCanCreateProject(organizationId, tx);

      // Custom Statuses Phase 1 (Section P) — see createClientAction's
      // own identical comment.
      const statusDefinition = await resolveSystemStatusDefinition(
        organizationId,
        "PROJECT",
        values.status.toLowerCase(),
        tx,
      );

      const project = await tx.project.create({
        data: {
          name: values.name,
          status: values.status,
          statusDefinitionId: statusDefinition?.id,
          startDate: values.startDate,
          endDate: values.endDate,
          clientId: values.clientId,
          // Kept for backward compatibility; organizationId is now the source
          // of truth for access scoping.
          ownerId: user.id,
          organizationId,
        },
      });

      await persistCustomFieldValuesInTransaction(tx, {
        organizationId,
        entityType: "PROJECT",
        entityId: project.id,
        definitions: customFieldDefinitions,
        rawValues: rawCustomFieldValues,
        decisions: customFieldValidation.decisions,
      });

      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "PROJECT",
        entityId: project.id,
        action: "CREATED",
        metadata: buildProjectMetadata(project, client.name, user.name),
      });
    });
  } catch (err) {
    if (err instanceof BillingLimitError) {
      return { error: err.message };
    }
    throw err;
  }

  redirect(withToast("/projects", "Project created"));
}
