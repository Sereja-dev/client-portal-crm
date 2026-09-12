import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tag } from "@/generated/prisma/client";
import type { CustomStatusColor, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { normalizeTagName } from "./normalize";

/**
 * Tags V1 Phase 1 — tag definition lifecycle (create/rename/archive/
 * list/get). Management (create/rename/archive) is OWNER/ADMIN-only,
 * mirroring src/lib/recurring-invoices/recurring-invoices.ts's own
 * isPrivileged() gate — a MEMBER can never create, rename, or archive a
 * Tag. Reading (list/get) is deliberately NOT role-gated: any Staff
 * member needs to see which tags exist in order to assign one (Section 3
 * — assignment is open to every Staff role), the same "reads are open,
 * only mutation is privileged" split Custom Statuses/Fields' own
 * definitions.ts already establishes for their own, differently-tiered
 * feature.
 *
 * Cross-org tag ids are never distinguishable from nonexistent ones —
 * every lookup is scoped by (id, organizationId) together, matching this
 * codebase's universal "a foreign-org id is indistinguishable from a
 * nonexistent one" doctrine.
 */

export type TagActor = { id: string; name: string; role: Role };

function isPrivileged(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

type DriverAdapterMeta = {
  driverAdapterError?: {
    cause?: { constraint?: { fields?: unknown } };
  };
};

/** True only for Tag's own (organizationId, normalizedName) unique constraint — same detection shape Custom Statuses/Fields' own isKeyConflict already establishes. `error.meta.target` is never populated on this project's Prisma/driver-adapter stack. */
function isNormalizedNameConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const fields = (err.meta as DriverAdapterMeta | undefined)?.driverAdapterError?.cause?.constraint?.fields;
  return (
    Array.isArray(fields) &&
    fields.length === 2 &&
    fields[0] === '"organizationId"' &&
    fields[1] === '"normalizedName"'
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateTagInput = { name: unknown; color?: CustomStatusColor | null };

export type CreateTagResult =
  | { ok: true; tag: Tag }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "INVALID_NAME"; error: string }
  | { ok: false; reason: "DUPLICATE_NAME" };

export async function createTag(
  organizationId: string,
  actor: TagActor,
  input: CreateTagInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateTagResult> {
  // Authorization checked first, before any DB read — a MEMBER never
  // learns whether a submitted name is even well-formed, matching
  // createRecurringInvoice/createWorkflowAutomation's own ordering.
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const parsed = normalizeTagName(input.name);
  if (!parsed.ok) {
    return { ok: false, reason: "INVALID_NAME", error: parsed.error };
  }

  // Application-level pre-check first — a fast, friendly rejection for
  // the common case. The real, concurrency-safe guarantee is the DB's
  // own @@unique([organizationId, normalizedName]) constraint, caught
  // below; this pre-check alone could never fully protect against two
  // genuinely concurrent requests racing to create the same name.
  const existing = await client.tag.findFirst({
    where: { organizationId, normalizedName: parsed.value.normalizedName },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, reason: "DUPLICATE_NAME" };
  }

  try {
    const tag = await client.tag.create({
      data: {
        organizationId,
        name: parsed.value.name,
        normalizedName: parsed.value.normalizedName,
        color: input.color ?? null,
      },
    });
    return { ok: true, tag };
  } catch (err) {
    if (isNormalizedNameConflict(err)) {
      return { ok: false, reason: "DUPLICATE_NAME" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export type RenameTagInput = { name: unknown; color?: CustomStatusColor | null };

export type RenameTagResult =
  | { ok: true; tag: Tag }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "INVALID_NAME"; error: string }
  | { ok: false; reason: "DUPLICATE_NAME" };

export async function renameTag(
  organizationId: string,
  tagId: string,
  actor: TagActor,
  input: RenameTagInput,
  client: PrismaClientOrTx = prisma,
): Promise<RenameTagResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await client.tag.findFirst({ where: { id: tagId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const parsed = normalizeTagName(input.name);
  if (!parsed.ok) {
    return { ok: false, reason: "INVALID_NAME", error: parsed.error };
  }

  // Only re-check for a conflict when the normalized name is actually
  // changing — renaming "VIP" to "VIP" (or just changing color) must
  // never spuriously collide with the row's own existing name.
  if (parsed.value.normalizedName !== existing.normalizedName) {
    const conflict = await client.tag.findFirst({
      where: { organizationId, normalizedName: parsed.value.normalizedName, id: { not: tagId } },
      select: { id: true },
    });
    if (conflict) {
      return { ok: false, reason: "DUPLICATE_NAME" };
    }
  }

  try {
    const tag = await client.tag.update({
      where: { id: tagId },
      data: {
        name: parsed.value.name,
        normalizedName: parsed.value.normalizedName,
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
    });
    return { ok: true, tag };
  } catch (err) {
    if (isNormalizedNameConflict(err)) {
      return { ok: false, reason: "DUPLICATE_NAME" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Archive — terminal in V1, same "no un-archive path yet" precedent as
// archiveRecurringInvoice/archiveWorkflowAutomation. Existing
// TagAssignment rows are left completely untouched — only the definition
// itself becomes unselectable for a NEW assignment going forward (see
// src/lib/tags/assignments.ts's own assignTag).
// ---------------------------------------------------------------------------

export type ArchiveTagResult =
  | { ok: true; tag: Tag }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "NOT_FOUND" };

export async function archiveTag(
  organizationId: string,
  tagId: string,
  actor: TagActor,
  client: PrismaClientOrTx = prisma,
): Promise<ArchiveTagResult> {
  if (!isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const existing = await client.tag.findFirst({ where: { id: tagId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    // Idempotent no-op — already archived, same convention
    // archiveRecurringInvoice/archiveWorkflowAutomation already use for a
    // redundant call.
    return { ok: true, tag: existing };
  }

  const tag = await client.tag.update({ where: { id: tagId }, data: { archivedAt: new Date() } });
  return { ok: true, tag };
}

// ---------------------------------------------------------------------------
// Read — never role-gated (see this module's own header comment).
// ---------------------------------------------------------------------------

export async function getTag(
  organizationId: string,
  tagId: string,
  client: PrismaClientOrTx = prisma,
): Promise<Tag | null> {
  return client.tag.findFirst({ where: { id: tagId, organizationId } });
}

export type ListTagsOptions = {
  /** Defaults to excluding archived rows — same convention as listCustomStatusDefinitions/listCustomFieldDefinitions/listWorkflowAutomations. */
  includeArchived?: boolean;
};

export async function listTags(
  organizationId: string,
  options: ListTagsOptions = {},
  client: PrismaClientOrTx = prisma,
): Promise<Tag[]> {
  return client.tag.findMany({
    where: {
      organizationId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ name: "asc" }],
  });
}
