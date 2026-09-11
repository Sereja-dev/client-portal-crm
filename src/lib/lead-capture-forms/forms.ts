import "server-only";
import { randomUUID } from "node:crypto";
import type { LeadCaptureForm } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import {
  validateLeadCaptureFormFieldsConfigInput,
  defaultLeadCaptureFormFieldsConfig,
  type LeadCaptureFormFieldsConfig,
} from "./fields";
import { parseLeadCaptureFormMetadata, type LeadCaptureFormMetadataInput, type LeadCaptureFormMetadataFieldErrors } from "@/lib/validation/lead-capture-form";

/**
 * Public Lead Capture Forms, Phase 1 — staff management domain layer.
 * Every function here is organization-scoped exactly like Custom
 * Statuses'/Custom Fields' own definitions.ts: a foreign-org id is always
 * treated as nonexistent, never a distinguishable "exists but denied"
 * case. No Server Action or UI wraps these yet (foundation-first, per
 * this phase's own spec) — callers resolve `organizationId` from an
 * authenticated session themselves, the same division of responsibility
 * every domain module in this codebase already follows.
 */

export type LeadCaptureFormMutationResult = { ok: true; form: LeadCaptureForm } | { ok: false; reason: "FORM_NOT_FOUND" };

export async function listLeadCaptureForms(
  organizationId: string,
  options: { includeArchived?: boolean } = {},
  client: PrismaClientOrTx = prisma,
): Promise<LeadCaptureForm[]> {
  return client.leadCaptureForm.findMany({
    where: {
      organizationId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getLeadCaptureForm(
  organizationId: string,
  formId: string,
  client: PrismaClientOrTx = prisma,
): Promise<LeadCaptureForm | null> {
  return client.leadCaptureForm.findFirst({ where: { id: formId, organizationId } });
}

export type CreateLeadCaptureFormInput = LeadCaptureFormMetadataInput & { fieldsConfig?: unknown };

export type CreateLeadCaptureFormResult =
  | { ok: true; form: LeadCaptureForm }
  | { ok: false; reason: "VALIDATION"; fieldErrors: LeadCaptureFormMetadataFieldErrors }
  | { ok: false; reason: "INVALID_FIELDS_CONFIG"; error: string };

/**
 * `publicToken` is generated here via `randomUUID()` — the same
 * opaque-random-token convention Invitation.token and the Client Portal
 * access token already use (see src/app/(dashboard)/team/actions.ts and
 * src/app/(dashboard)/clients/[id]/edit/portal-access-actions.ts), never
 * derived from organizationId or this row's own `id`. No collision-retry
 * loop, matching those same call sites' own precedent — a UUIDv4
 * collision is not a case this codebase guards against anywhere today.
 */
export async function createLeadCaptureForm(
  organizationId: string,
  input: CreateLeadCaptureFormInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateLeadCaptureFormResult> {
  const { values, fieldErrors } = parseLeadCaptureFormMetadata(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }

  const fieldsConfigResult = validateLeadCaptureFormFieldsConfigInput(input.fieldsConfig);
  if (!fieldsConfigResult.ok) {
    return { ok: false, reason: "INVALID_FIELDS_CONFIG", error: fieldsConfigResult.error };
  }
  const fieldsConfig: LeadCaptureFormFieldsConfig =
    Object.keys(fieldsConfigResult.config).length > 0 ? fieldsConfigResult.config : defaultLeadCaptureFormFieldsConfig();

  const form = await client.leadCaptureForm.create({
    data: {
      organizationId,
      name: values.name,
      publicToken: randomUUID(),
      title: values.title,
      description: values.description,
      successMessage: values.successMessage,
      fieldsConfig,
    },
  });

  return { ok: true, form };
}

export type UpdateLeadCaptureFormInput = Partial<LeadCaptureFormMetadataInput> & { fieldsConfig?: unknown };

export type UpdateLeadCaptureFormResult =
  | { ok: true; form: LeadCaptureForm }
  | { ok: false; reason: "FORM_NOT_FOUND" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: LeadCaptureFormMetadataFieldErrors }
  | { ok: false; reason: "INVALID_FIELDS_CONFIG"; error: string };

export async function updateLeadCaptureForm(
  organizationId: string,
  formId: string,
  input: UpdateLeadCaptureFormInput,
  client: PrismaClientOrTx = prisma,
): Promise<UpdateLeadCaptureFormResult> {
  const existing = await client.leadCaptureForm.findFirst({ where: { id: formId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "FORM_NOT_FOUND" };
  }

  const { values, fieldErrors } = parseLeadCaptureFormMetadata({
    name: input.name ?? existing.name,
    title: input.title ?? existing.title,
    description: input.description !== undefined ? input.description : existing.description,
    successMessage: input.successMessage !== undefined ? input.successMessage : existing.successMessage,
  });
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }

  let fieldsConfig: LeadCaptureFormFieldsConfig | undefined;
  if (input.fieldsConfig !== undefined) {
    const fieldsConfigResult = validateLeadCaptureFormFieldsConfigInput(input.fieldsConfig);
    if (!fieldsConfigResult.ok) {
      return { ok: false, reason: "INVALID_FIELDS_CONFIG", error: fieldsConfigResult.error };
    }
    fieldsConfig = fieldsConfigResult.config;
  }

  const form = await client.leadCaptureForm.update({
    where: { id: formId },
    data: {
      name: values.name,
      title: values.title,
      description: values.description,
      successMessage: values.successMessage,
      ...(fieldsConfig !== undefined ? { fieldsConfig } : {}),
    },
  });

  return { ok: true, form };
}

export async function setLeadCaptureFormActive(
  organizationId: string,
  formId: string,
  isActive: boolean,
  client: PrismaClientOrTx = prisma,
): Promise<LeadCaptureFormMutationResult> {
  const existing = await client.leadCaptureForm.findFirst({ where: { id: formId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "FORM_NOT_FOUND" };
  }
  if (existing.isActive === isActive) {
    return { ok: true, form: existing };
  }
  const form = await client.leadCaptureForm.update({ where: { id: formId }, data: { isActive } });
  return { ok: true, form };
}

/** Soft-archives a form (same convention as Lead.archivedAt/CustomFieldDefinition.archivedAt). Idempotent. */
export async function archiveLeadCaptureForm(
  organizationId: string,
  formId: string,
  client: PrismaClientOrTx = prisma,
): Promise<LeadCaptureFormMutationResult> {
  const existing = await client.leadCaptureForm.findFirst({ where: { id: formId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "FORM_NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    return { ok: true, form: existing };
  }
  const form = await client.leadCaptureForm.update({ where: { id: formId }, data: { archivedAt: new Date() } });
  return { ok: true, form };
}

/** Restores an archived form. Idempotent. Its publicToken/fieldsConfig are untouched — unarchiving is a pure archivedAt flip. */
export async function unarchiveLeadCaptureForm(
  organizationId: string,
  formId: string,
  client: PrismaClientOrTx = prisma,
): Promise<LeadCaptureFormMutationResult> {
  const existing = await client.leadCaptureForm.findFirst({ where: { id: formId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "FORM_NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    return { ok: true, form: existing };
  }
  const form = await client.leadCaptureForm.update({ where: { id: formId }, data: { archivedAt: null } });
  return { ok: true, form };
}
