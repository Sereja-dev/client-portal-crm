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
import { resolveStatusForSave } from "@/lib/custom-statuses/entity-form";
import type { ProjectStatusValue } from "@/lib/validation/project";
import type { ProjectFormState } from "@/types";

/** Thrown only inside createProjectAction's own transaction, to carry a typed rejection reason out to its catch block — never allowed to escape this function (Section R). */
class ProjectStatusResolutionError extends Error {
  constructor(readonly reason: "NOT_FOUND" | "ARCHIVED") {
    super(`Project status resolution rejected: ${reason}`);
  }
}

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

      // Custom Statuses Phase 2B (Section O/R) — see createClientAction's
      // own identical comment for the full reasoning (resolve+verify the
      // Staff-selected definition; SYSTEM writes its own matching legacy
      // enum; CUSTOM falls back to "PLANNING", the exact pre-existing
      // schema-level default, never an invented neutral value).
      const statusResult = await resolveStatusForSave(organizationId, "PROJECT", values.statusDefinitionId, null, tx);
      if (!statusResult.ok) {
        throw new ProjectStatusResolutionError(statusResult.reason);
      }
      const legacyStatus: ProjectStatusValue = statusResult.isSystem
        ? (statusResult.key.toUpperCase() as ProjectStatusValue)
        : "PLANNING";

      const project = await tx.project.create({
        data: {
          name: values.name,
          status: legacyStatus,
          statusDefinitionId: statusResult.definitionId,
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
    if (err instanceof ProjectStatusResolutionError) {
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

  redirect(withToast("/projects", "Project created"));
}
