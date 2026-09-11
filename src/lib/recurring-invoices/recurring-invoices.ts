import "server-only";
import type { RecurringInvoice, RecurringInvoiceLineItem } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { resolveRecurringInvoiceTarget } from "./target";
import { deriveAnchorDay } from "./date-math";
import {
  isUuid,
  isValidFrequency,
  parseFirstIssueDate,
  parseRecurringInvoiceTemplateFields,
  type ParsedRecurringInvoiceTemplateFields,
  type RecurringInvoiceFieldErrors,
  type RecurringInvoiceLineItemInput,
  type RecurrenceFrequencyValue,
} from "@/lib/validation/recurring-invoice";
import { createActivity } from "@/lib/activity/create-activity";
import {
  diffRecurringInvoiceFields,
  buildRecurringInvoiceSnapshotMetadata,
  buildRecurringInvoiceUpdatedMetadata,
  buildRecurringInvoiceStatusChangedMetadata,
} from "@/lib/activity/recurring-invoice-metadata";

/**
 * Recurring Invoices Phase 1 — domain/management layer (create, edit,
 * pause/resume/archive, read). The generation engine itself lives in
 * generate.ts, a separate module — this file never claims/generates an
 * occurrence.
 *
 * Permissions (per the finalized V1 design): every function in this file
 * is OWNER/ADMIN-only. A MEMBER can never create, edit, pause, resume,
 * archive, or even read/list a RecurringInvoice — this app has no
 * documented MEMBER-readable-but-not-writable tier for this feature (the
 * finalized design's own permission statement covers the whole feature,
 * not just the write paths), so reads are gated identically to writes
 * rather than introducing an undocumented third tier. There is no Staff
 * UI yet to expose any of this — every function here is invoked directly
 * by tests in this phase.
 *
 * Update scope is deliberately narrower than create's: updateRecurringInvoice
 * never touches frequency, anchorDay, nextIssueDate, or nextSequence.
 * Changing the recurrence schedule itself (frequency/anchor) is a genuine
 * "reschedule" decision the readiness assessment explicitly flagged as its
 * own separate concern, never resolved as part of this phase — and
 * nextSequence/nextIssueDate are the generation engine's own internal
 * state, never client-settable (matches this phase's own explicit "do not
 * let clients directly set... attemptCount" etc. rule, extended to the
 * two schedule-advancement fields for the same reason). status changes
 * only ever go through pause/resume/archive, never through update.
 *
 * A generated Invoice is never rewritten by an update here — see
 * generate.ts's own header comment; this module never touches an Invoice
 * row at all.
 */

export type RecurringInvoiceActor = { id: string; name: string; role: Role };

function isPrivileged(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const LINE_ITEMS_ORDER = { lineItems: { orderBy: { position: "asc" as const } } };

export type RecurringInvoiceWithLineItems = RecurringInvoice & { lineItems: RecurringInvoiceLineItem[] };

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateRecurringInvoiceInput = {
  name?: unknown;
  clientId: unknown;
  projectId?: unknown;
  frequency: unknown;
  /** Seeds both nextIssueDate and the immutable anchorDay — strict "YYYY-MM-DD". */
  firstIssueDate: unknown;
  invoiceNumberPrefix: unknown;
  /** Defaults to 1 when omitted. */
  startingSequence?: unknown;
  dueDateOffsetDays?: unknown;
  currency: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  taxRatePercent?: unknown;
  taxLabel?: unknown;
  notes?: unknown;
  internalNotes?: unknown;
  lineItems: RecurringInvoiceLineItemInput[];
};

export type CreateRecurringInvoiceResult =
  | { ok: true; recurringInvoice: RecurringInvoiceWithLineItems }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: RecurringInvoiceFieldErrors }
  | { ok: false; reason: "INVALID_TARGET" };

export async function createRecurringInvoice(
  organizationId: string,
  actor: RecurringInvoiceActor,
  input: CreateRecurringInvoiceInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateRecurringInvoiceResult> {
  // Authorization checked first, before any DB read — a MEMBER never
  // learns whether a submitted clientId/projectId even exist.
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const fieldErrors: RecurringInvoiceFieldErrors = {};

  if (!isUuid(input.clientId)) {
    fieldErrors.clientId = "Select a valid client.";
  }
  const projectIdProvided = input.projectId !== undefined && input.projectId !== null && input.projectId !== "";
  if (projectIdProvided && !isUuid(input.projectId)) {
    fieldErrors.projectId = "Select a valid project.";
  }
  if (!isValidFrequency(input.frequency)) {
    fieldErrors.frequency = "Select a valid frequency.";
  }
  const firstIssueDateResult = parseFirstIssueDate(input.firstIssueDate);
  if (!firstIssueDateResult.ok) {
    fieldErrors.firstIssueDate = "Enter a valid date (YYYY-MM-DD).";
  }

  const templateFields = parseRecurringInvoiceTemplateFields(input);
  if (!templateFields.ok) {
    Object.assign(fieldErrors, templateFields.fieldErrors);
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }
  const values = (templateFields as { ok: true; values: ParsedRecurringInvoiceTemplateFields }).values;
  const firstIssueDate = (firstIssueDateResult as { ok: true; date: Date }).date;
  const frequency = input.frequency as RecurrenceFrequencyValue;

  const targetResult = await resolveRecurringInvoiceTarget(client, organizationId, {
    clientId: input.clientId as string,
    projectId: projectIdProvided ? (input.projectId as string) : null,
  });
  if (!targetResult.ok) {
    return { ok: false, reason: "INVALID_TARGET" };
  }
  const { target } = targetResult;

  const anchorDay = deriveAnchorDay(firstIssueDate);

  const runCreate = async (tx: PrismaClientOrTx) => {
    const created = await tx.recurringInvoice.create({
      data: {
        organizationId,
        clientId: target.clientId,
        projectId: target.projectId,
        name: values.name,
        status: "ACTIVE",
        frequency,
        anchorDay,
        nextIssueDate: firstIssueDate,
        invoiceNumberPrefix: values.invoiceNumberPrefix,
        nextSequence: values.startingSequence,
        dueDateOffsetDays: values.dueDateOffsetDays,
        currency: values.currency,
        discountType: values.discountType,
        discountValue: values.discountValue,
        taxRatePercent: values.taxRatePercent,
        taxLabel: values.taxLabel,
        notes: values.notes,
        internalNotes: values.internalNotes,
        lineItems: {
          create: values.lineItems.map((li, index) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            position: index,
          })),
        },
      },
      include: LINE_ITEMS_ORDER,
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "RECURRING_INVOICE",
      entityId: created.id,
      action: "CREATED",
      metadata: buildRecurringInvoiceSnapshotMetadata(created, created.lineItems.length, actor.name),
    });

    return created;
  };

  const recurringInvoice = client === prisma ? await prisma.$transaction((tx) => runCreate(tx)) : await runCreate(client);
  return { ok: true, recurringInvoice };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateRecurringInvoiceInput = {
  name?: unknown;
  clientId?: unknown;
  /** Omit for "no change"; explicit null clears the Project. */
  projectId?: unknown;
  invoiceNumberPrefix?: unknown;
  dueDateOffsetDays?: unknown;
  currency?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  taxRatePercent?: unknown;
  taxLabel?: unknown;
  notes?: unknown;
  internalNotes?: unknown;
  lineItems?: RecurringInvoiceLineItemInput[];
};

export type UpdateRecurringInvoiceResult =
  | { ok: true; recurringInvoice: RecurringInvoiceWithLineItems }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: RecurringInvoiceFieldErrors }
  | { ok: false; reason: "INVALID_TARGET" };

export async function updateRecurringInvoice(
  organizationId: string,
  recurringInvoiceId: string,
  actor: RecurringInvoiceActor,
  input: UpdateRecurringInvoiceInput,
  client: PrismaClientOrTx = prisma,
): Promise<UpdateRecurringInvoiceResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await client.recurringInvoice.findFirst({
    where: { id: recurringInvoiceId, organizationId },
    include: LINE_ITEMS_ORDER,
  });
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const clientIdProvided = input.clientId !== undefined;
  if (clientIdProvided && !isUuid(input.clientId)) {
    return { ok: false, reason: "VALIDATION", fieldErrors: { clientId: "Select a valid client." } };
  }
  const projectIdProvided = input.projectId !== undefined;
  if (projectIdProvided && input.projectId !== null && !isUuid(input.projectId)) {
    return { ok: false, reason: "VALIDATION", fieldErrors: { projectId: "Select a valid project." } };
  }

  const templateFields = parseRecurringInvoiceTemplateFields({
    name: input.name !== undefined ? input.name : existing.name,
    invoiceNumberPrefix: input.invoiceNumberPrefix !== undefined ? input.invoiceNumberPrefix : existing.invoiceNumberPrefix,
    dueDateOffsetDays: input.dueDateOffsetDays !== undefined ? input.dueDateOffsetDays : existing.dueDateOffsetDays,
    currency: input.currency !== undefined ? input.currency : existing.currency,
    discountType: input.discountType !== undefined ? input.discountType : existing.discountType,
    discountValue:
      input.discountValue !== undefined ? input.discountValue : existing.discountValue !== null ? String(existing.discountValue) : null,
    taxRatePercent:
      input.taxRatePercent !== undefined ? input.taxRatePercent : existing.taxRatePercent !== null ? String(existing.taxRatePercent) : null,
    taxLabel: input.taxLabel !== undefined ? input.taxLabel : existing.taxLabel,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    internalNotes: input.internalNotes !== undefined ? input.internalNotes : existing.internalNotes,
    lineItems:
      input.lineItems !== undefined
        ? input.lineItems
        : existing.lineItems.map((li) => ({ description: li.description, quantity: li.quantity.toString(), unitPrice: li.unitPrice.toString() })),
  });
  if (!templateFields.ok) {
    return { ok: false, reason: "VALIDATION", fieldErrors: templateFields.fieldErrors };
  }
  const values = templateFields.values;

  const targetResult = await resolveRecurringInvoiceTarget(client, organizationId, {
    clientId: clientIdProvided ? (input.clientId as string) : existing.clientId,
    projectId: projectIdProvided ? ((input.projectId as string | null) ?? null) : existing.projectId,
  });
  if (!targetResult.ok) {
    return { ok: false, reason: "INVALID_TARGET" };
  }
  const { target } = targetResult;

  const afterSnapshot = {
    name: values.name,
    clientId: target.clientId,
    projectId: target.projectId,
    invoiceNumberPrefix: values.invoiceNumberPrefix,
    dueDateOffsetDays: values.dueDateOffsetDays,
    currency: values.currency,
    discountType: values.discountType,
    discountValue: values.discountValue,
    taxRatePercent: values.taxRatePercent,
    taxLabel: values.taxLabel,
    notes: values.notes,
    internalNotes: values.internalNotes,
    lineItems: values.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice })),
  };
  const beforeSnapshot = {
    name: existing.name,
    clientId: existing.clientId,
    projectId: existing.projectId,
    invoiceNumberPrefix: existing.invoiceNumberPrefix,
    dueDateOffsetDays: existing.dueDateOffsetDays,
    currency: existing.currency,
    discountType: existing.discountType,
    discountValue: existing.discountValue,
    taxRatePercent: existing.taxRatePercent,
    taxLabel: existing.taxLabel,
    notes: existing.notes,
    internalNotes: existing.internalNotes,
    lineItems: existing.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice })),
  };
  const changedFields = diffRecurringInvoiceFields(beforeSnapshot, afterSnapshot);

  if (changedFields.length === 0) {
    // Idempotent no-op — same convention as every other domain module this
    // session (updateTimeEntry, archiveClientRequest): no write, no
    // Activity row.
    return { ok: true, recurringInvoice: existing };
  }

  const runUpdate = async (tx: PrismaClientOrTx) => {
    // Line items are always fully replaced (deleteMany + recreate,
    // server-assigned contiguous positions) — same convention as every
    // itemized-line-item write in this app; a RecurringInvoiceLineItem has
    // no independent identity a caller could address for a partial edit.
    await tx.recurringInvoiceLineItem.deleteMany({ where: { recurringInvoiceId } });

    const updated = await tx.recurringInvoice.update({
      where: { id: recurringInvoiceId },
      data: {
        name: afterSnapshot.name,
        clientId: afterSnapshot.clientId,
        projectId: afterSnapshot.projectId,
        invoiceNumberPrefix: afterSnapshot.invoiceNumberPrefix,
        dueDateOffsetDays: afterSnapshot.dueDateOffsetDays,
        currency: afterSnapshot.currency,
        discountType: afterSnapshot.discountType,
        discountValue: afterSnapshot.discountValue,
        taxRatePercent: afterSnapshot.taxRatePercent,
        taxLabel: afterSnapshot.taxLabel,
        notes: afterSnapshot.notes,
        internalNotes: afterSnapshot.internalNotes,
        lineItems: {
          create: values.lineItems.map((li, index) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            position: index,
          })),
        },
      },
      include: LINE_ITEMS_ORDER,
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "RECURRING_INVOICE",
      entityId: recurringInvoiceId,
      action: "UPDATED",
      metadata: buildRecurringInvoiceUpdatedMetadata(updated.name, changedFields, actor.name),
    });

    return updated;
  };

  const recurringInvoice = client === prisma ? await prisma.$transaction((tx) => runUpdate(tx)) : await runUpdate(client);
  return { ok: true, recurringInvoice };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getRecurringInvoice(
  organizationId: string,
  recurringInvoiceId: string,
  actor: RecurringInvoiceActor,
  client: PrismaClientOrTx = prisma,
): Promise<{ ok: true; recurringInvoice: RecurringInvoiceWithLineItems | null } | { ok: false; reason: "FORBIDDEN" }> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const recurringInvoice = await client.recurringInvoice.findFirst({
    where: { id: recurringInvoiceId, organizationId },
    include: LINE_ITEMS_ORDER,
  });
  return { ok: true, recurringInvoice };
}

export type ListRecurringInvoicesOptions = {
  status?: "ACTIVE" | "PAUSED" | "ARCHIVED";
  clientId?: string;
};

export async function listRecurringInvoices(
  organizationId: string,
  actor: RecurringInvoiceActor,
  options: ListRecurringInvoicesOptions = {},
  client: PrismaClientOrTx = prisma,
): Promise<{ ok: true; recurringInvoices: RecurringInvoiceWithLineItems[] } | { ok: false; reason: "FORBIDDEN" }> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const recurringInvoices = await client.recurringInvoice.findMany({
    where: {
      organizationId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: LINE_ITEMS_ORDER,
  });
  return { ok: true, recurringInvoices };
}

// ---------------------------------------------------------------------------
// Lifecycle — pause / resume / archive
// ---------------------------------------------------------------------------

export type RecurringInvoiceLifecycleResult =
  | { ok: true; recurringInvoice: RecurringInvoice }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "INVALID_TRANSITION" };

async function setStatus(
  organizationId: string,
  recurringInvoiceId: string,
  actor: RecurringInvoiceActor,
  to: "ACTIVE" | "PAUSED" | "ARCHIVED",
  allowedFrom: readonly ("ACTIVE" | "PAUSED" | "ARCHIVED")[],
  client: PrismaClientOrTx,
): Promise<RecurringInvoiceLifecycleResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await client.recurringInvoice.findFirst({ where: { id: recurringInvoiceId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (existing.status === to) {
    // Idempotent no-op — same "already in this state" convention as
    // archiveTimeEntry/archiveClientRequest.
    return { ok: true, recurringInvoice: existing };
  }
  if (!allowedFrom.includes(existing.status)) {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }

  const runTransition = async (tx: PrismaClientOrTx) => {
    const updated = await tx.recurringInvoice.update({ where: { id: recurringInvoiceId }, data: { status: to } });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "RECURRING_INVOICE",
      entityId: recurringInvoiceId,
      action: "STATUS_CHANGED",
      metadata: buildRecurringInvoiceStatusChangedMetadata(existing.name, existing.status, to, actor.name),
    });

    return updated;
  };

  const recurringInvoice = client === prisma ? await prisma.$transaction((tx) => runTransition(tx)) : await runTransition(client);
  return { ok: true, recurringInvoice };
}

/** ACTIVE -> PAUSED only. nextIssueDate is untouched — resuming continues exactly where it left off. */
export async function pauseRecurringInvoice(
  organizationId: string,
  recurringInvoiceId: string,
  actor: RecurringInvoiceActor,
  client: PrismaClientOrTx = prisma,
): Promise<RecurringInvoiceLifecycleResult> {
  return setStatus(organizationId, recurringInvoiceId, actor, "PAUSED", ["ACTIVE"], client);
}

/** PAUSED -> ACTIVE only. */
export async function resumeRecurringInvoice(
  organizationId: string,
  recurringInvoiceId: string,
  actor: RecurringInvoiceActor,
  client: PrismaClientOrTx = prisma,
): Promise<RecurringInvoiceLifecycleResult> {
  return setStatus(organizationId, recurringInvoiceId, actor, "ACTIVE", ["PAUSED"], client);
}

/** ACTIVE or PAUSED -> ARCHIVED. Terminal — no un-archive path in V1 (matches Client Requests' own Phase 2A archive asymmetry). */
export async function archiveRecurringInvoice(
  organizationId: string,
  recurringInvoiceId: string,
  actor: RecurringInvoiceActor,
  client: PrismaClientOrTx = prisma,
): Promise<RecurringInvoiceLifecycleResult> {
  return setStatus(organizationId, recurringInvoiceId, actor, "ARCHIVED", ["ACTIVE", "PAUSED"], client);
}
