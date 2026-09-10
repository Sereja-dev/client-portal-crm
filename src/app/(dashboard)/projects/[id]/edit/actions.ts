"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { parseProjectForm } from "@/lib/validation/project";
import { withToast } from "@/lib/toast-url";
import { createActivity } from "@/lib/activity/create-activity";
import {
  diffProjectFields,
  buildProjectStatusChangedMetadata,
  buildProjectUpdatedMetadata,
} from "@/lib/activity/project-metadata";
import {
  getActiveCustomFieldFormDefinitions,
  getCustomFieldFormValues,
  parseCustomFieldFormValues,
  validateCustomFieldFormValues,
  persistCustomFieldValuesInTransaction,
} from "@/lib/custom-fields/entity-form";
import { resolveStatusForSave } from "@/lib/custom-statuses/entity-form";
import type { ProjectStatusValue } from "@/lib/validation/project";
import type { ProjectFormState } from "@/types";

export async function updateProjectAction(
  projectId: string,
  _prevState: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const { values, fieldErrors } = parseProjectForm(formData);

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const { user, organizationId } = await getCurrentUserOrganization();

  // Changing the client is allowed, but only to one owned by this org —
  // re-verify server-side regardless of what the <select> offered. Also
  // resolves the (possibly new) client's name for Activity metadata.
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

  // Custom Fields Phase 2B (Section F/H/I/J/K) — see updateClientAction's
  // own identical comment.
  const customFieldDefinitions = await getActiveCustomFieldFormDefinitions(organizationId, "PROJECT");
  const existingCustomFieldValues = await getCustomFieldFormValues(
    organizationId,
    "PROJECT",
    projectId,
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

  // Update and its Activity row(s) are one atomic unit — if any Activity
  // insert fails, the whole update rolls back with it.
  const outcome = await prisma.$transaction(async (tx) => {
    // Scoped by id + organizationId together — a foreign org's project id
    // simply doesn't match, indistinguishable from a nonexistent one. Also
    // doubles as the "before" snapshot for change-detection below.
    const existing = await tx.project.findFirst({
      where: { id: projectId, organizationId },
      include: { client: { select: { name: true } } },
    });

    if (!existing) {
      return "not_found" as const;
    }

    // Custom Statuses Phase 2B (Section O/R) — see updateClientAction's
    // own identical comment.
    const statusResult = await resolveStatusForSave(
      organizationId,
      "PROJECT",
      values.statusDefinitionId,
      existing.statusDefinitionId,
      tx,
    );
    if (!statusResult.ok) {
      return statusResult.reason === "ARCHIVED" ? ("status_archived" as const) : ("status_not_found" as const);
    }
    const legacyStatus: ProjectStatusValue | undefined = statusResult.isSystem
      ? (statusResult.key.toUpperCase() as ProjectStatusValue)
      : undefined;

    const result = await tx.project.updateMany({
      where: { id: projectId, organizationId },
      data: {
        name: values.name,
        status: legacyStatus,
        statusDefinitionId: statusResult.definitionId,
        startDate: values.startDate,
        endDate: values.endDate,
        clientId: values.clientId,
      },
    });

    if (result.count === 0) {
      return "not_found" as const;
    }

    await persistCustomFieldValuesInTransaction(tx, {
      organizationId,
      entityType: "PROJECT",
      entityId: projectId,
      definitions: customFieldDefinitions,
      rawValues: rawCustomFieldValues,
      decisions: customFieldValidation.decisions,
    });

    // A pure resubmit of identical values creates no Activity at all.
    // "status" is always split out into its own STATUS_CHANGED event, so
    // it's never listed in an UPDATED event's changedFields even when both
    // fire together. `values.status` from parseProjectForm is never real
    // anymore (the form no longer submits a `status` field — see this
    // file's own comment above) — substituted with the actual computed
    // legacy value (falling back to the row's own existing value for a
    // CUSTOM target, whose legacy column was left untouched), so the
    // diff and Activity metadata both describe what genuinely changed.
    const valuesForActivity = { ...values, status: legacyStatus ?? existing.status };
    const changedFields = diffProjectFields(existing, valuesForActivity);
    const statusChanged = changedFields.includes("status");
    const otherChangedFields = changedFields.filter((field) => field !== "status");

    if (statusChanged) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "PROJECT",
        entityId: projectId,
        action: "STATUS_CHANGED",
        metadata: buildProjectStatusChangedMetadata(
          valuesForActivity,
          client.name,
          existing.status,
          valuesForActivity.status,
          user.name,
        ),
      });
    }

    if (otherChangedFields.length > 0) {
      await createActivity(tx, {
        organizationId,
        actorId: user.id,
        entityType: "PROJECT",
        entityId: projectId,
        action: "UPDATED",
        metadata: buildProjectUpdatedMetadata(valuesForActivity, client.name, otherChangedFields, user.name),
      });
    }

    return "updated" as const;
  });

  if (outcome === "not_found") {
    return { error: "This project could not be found." };
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

  redirect(withToast("/projects", "Project updated"));
}
