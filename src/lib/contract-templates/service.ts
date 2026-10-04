import "server-only";
import { prisma } from "@/lib/prisma";
import type { ContractTemplate } from "@/generated/prisma/client";
import { canManageContractTemplates, type ContractTemplateActor } from "./authorization";
import {
  parseContractTemplateInput,
  hasContractTemplateFormErrors,
  CONTRACT_TEMPLATE_NAME_MAX_LENGTH,
  type ContractTemplateWritableInput,
  type ContractTemplateFieldErrors,
} from "./validation";
import { getContractTemplateForManagement } from "./queries";
import type { PrismaClientOrTx } from "./types";

/**
 * Contract Templates V1 — management mutations (create/update/archive/
 * restore/duplicate). Mirrors src/lib/invoice-templates/service.ts's own
 * established domain-module shape exactly: authorization checked first,
 * before any DB read; every lookup/write scoped by (id, organizationId)
 * together; archive/restore are idempotent no-ops on a redundant call; a
 * discriminated-union result instead of a thrown error for every
 * *expected* outcome (FORBIDDEN, NOT_FOUND, VALIDATION).
 *
 * organizationId and `actor` are always caller-supplied, already resolved
 * server-side from the current session (never accepted as raw input by
 * this module itself) — matching every other domain module in this app.
 *
 * No line-item/total calculation of any kind exists here (unlike Invoice/
 * Quote Templates) — ContractTemplate is a single-row configuration
 * entity with no child table (see its own schema comment).
 *
 * Snapshot semantics: nothing in this file ever writes to a Contract row,
 * and nothing in the Contract domain ever reads from ContractTemplate —
 * the two are fully decoupled by construction (see ContractTemplate's own
 * schema doc comment). No Contract Activity row is written by any
 * function here (template management is not a Contract lifecycle event —
 * see the approved Slice B spec's own §23) and no Workflow Automation
 * event is ever triggered (management/application of a template creates
 * no Contract at all).
 */

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateContractTemplateResult =
  | { ok: true; template: ContractTemplate }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: ContractTemplateFieldErrors };

export async function createContractTemplate(
  organizationId: string,
  actor: ContractTemplateActor,
  input: ContractTemplateWritableInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateContractTemplateResult> {
  if (!(await canManageContractTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const { values, fieldErrors } = parseContractTemplateInput(input);
  if (hasContractTemplateFormErrors(fieldErrors)) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }

  const template = await client.contractTemplate.create({
    data: {
      organizationId,
      name: values.name,
      title: values.title,
      body: values.body,
      defaultExpiryOffsetDays: values.defaultExpiryOffsetDays,
      internalNotes: values.internalNotes,
      createdByUserId: actor.id,
    },
  });
  return { ok: true, template };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateContractTemplateResult =
  | { ok: true; template: ContractTemplate }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: ContractTemplateFieldErrors };

/**
 * Whole-record update: every writable field is replaced in one plain
 * update (no child rows to delete/recreate, unlike Invoice/Quote
 * Templates — ContractTemplate has no item table). Archived state is
 * untouched by this function — updating the content of an archived
 * template is allowed; only restoreContractTemplate flips that.
 */
export async function updateContractTemplate(
  organizationId: string,
  templateId: string,
  actor: ContractTemplateActor,
  input: ContractTemplateWritableInput,
): Promise<UpdateContractTemplateResult> {
  if (!(await canManageContractTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getContractTemplateForManagement(organizationId, templateId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const { values, fieldErrors } = parseContractTemplateInput(input);
  if (hasContractTemplateFormErrors(fieldErrors)) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }

  const template = await prisma.contractTemplate.update({
    where: { id: templateId },
    data: {
      name: values.name,
      title: values.title,
      body: values.body,
      defaultExpiryOffsetDays: values.defaultExpiryOffsetDays,
      internalNotes: values.internalNotes,
    },
  });
  return { ok: true, template };
}

// ---------------------------------------------------------------------------
// Archive / Restore
// ---------------------------------------------------------------------------

export type ArchiveContractTemplateResult =
  | { ok: true; template: ContractTemplate }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" };

export async function archiveContractTemplate(
  organizationId: string,
  templateId: string,
  actor: ContractTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<ArchiveContractTemplateResult> {
  if (!(await canManageContractTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getContractTemplateForManagement(organizationId, templateId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    // Idempotent no-op -- already archived, same convention
    // archiveInvoiceTemplate already uses for a redundant call.
    return { ok: true, template: existing };
  }

  const template = await client.contractTemplate.update({
    where: { id: templateId },
    data: { archivedAt: new Date() },
  });
  return { ok: true, template };
}

export type RestoreContractTemplateResult = ArchiveContractTemplateResult;

export async function restoreContractTemplate(
  organizationId: string,
  templateId: string,
  actor: ContractTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<RestoreContractTemplateResult> {
  if (!(await canManageContractTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await getContractTemplateForManagement(organizationId, templateId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    // Idempotent no-op -- already active.
    return { ok: true, template: existing };
  }

  const template = await client.contractTemplate.update({
    where: { id: templateId },
    data: { archivedAt: null },
  });
  return { ok: true, template };
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

export type DuplicateContractTemplateResult =
  | { ok: true; template: ContractTemplate }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" };

/**
 * Duplicates a template (any state, active or archived) into a brand-new,
 * always-ACTIVE template with a brand-new id -- never copies `archivedAt`
 * as archived, regardless of the source's own state. The current
 * authenticated privileged actor becomes the new row's own creator,
 * independent of who created the source (audit metadata only). Name is a
 * simple, deterministic `"<original name> Copy"` -- no collision
 * numbering, since names are deliberately never required to be unique.
 * Mirrors duplicateInvoiceTemplate/duplicateQuoteTemplate exactly.
 */
export async function duplicateContractTemplate(
  organizationId: string,
  templateId: string,
  actor: ContractTemplateActor,
  client: PrismaClientOrTx = prisma,
): Promise<DuplicateContractTemplateResult> {
  if (!(await canManageContractTemplates(organizationId, actor.role))) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const source = await getContractTemplateForManagement(organizationId, templateId, client);
  if (!source) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  // Deliberately no collision-numbering loop (see this function's own
  // doc comment) -- the raw " Copy" suffix can itself push past
  // CONTRACT_TEMPLATE_NAME_MAX_LENGTH for an already-long source name;
  // truncating the ORIGINAL portion (never silently dropping the "
  // Copy" suffix, which is what actually signals this is a duplicate)
  // keeps the result always valid.
  const suffix = " Copy";
  const maxOriginalLength = CONTRACT_TEMPLATE_NAME_MAX_LENGTH - suffix.length;
  const truncatedName = source.name.length > maxOriginalLength ? source.name.slice(0, maxOriginalLength) : source.name;
  const newName = `${truncatedName}${suffix}`;

  const template = await client.contractTemplate.create({
    data: {
      organizationId,
      name: newName,
      title: source.title,
      body: source.body,
      defaultExpiryOffsetDays: source.defaultExpiryOffsetDays,
      internalNotes: source.internalNotes,
      createdByUserId: actor.id,
      archivedAt: null,
    },
  });
  return { ok: true, template };
}
