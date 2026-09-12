import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tag, TagAssignment } from "@/generated/prisma/client";
import type { TagEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { assertTagEntityOwnership } from "./entity-ownership";

/**
 * Tags V1 Phase 1 — tag assignment (attach/detach a Tag on a Client or
 * Lead). Open to every Staff role (OWNER/ADMIN/MEMBER) — consistent with
 * this codebase's existing Client/Lead edit permissions, and
 * deliberately NOT gated the way src/lib/tags/definitions.ts's own
 * create/rename/archive are. Every operation here independently
 * re-verifies both sides of the assignment against the authoritative
 * organizationId — the tag via a plain org-scoped lookup, the entity via
 * assertTagEntityOwnership — never trusting an organizationId supplied
 * by the caller/request.
 */

export type AssignTagResult =
  | { ok: true; assignment: TagAssignment }
  | { ok: false; reason: "TAG_NOT_FOUND" }
  | { ok: false; reason: "ENTITY_NOT_FOUND" }
  | { ok: false; reason: "TAG_ARCHIVED" };

export async function assignTag(
  organizationId: string,
  tagId: string,
  entityType: TagEntityType,
  entityId: string,
  client: PrismaClientOrTx = prisma,
): Promise<AssignTagResult> {
  const tag: Tag | null = await client.tag.findFirst({ where: { id: tagId, organizationId } });
  if (!tag) {
    return { ok: false, reason: "TAG_NOT_FOUND" };
  }

  const ownsEntity = await assertTagEntityOwnership(organizationId, entityType, entityId, client);
  if (!ownsEntity) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }

  // Idempotency check comes BEFORE the archived-state check, deliberately:
  // re-affirming an assignment that already exists must succeed even if
  // the tag has since been archived (archiving only blocks *new*
  // assignments — see archiveTag's own doc comment). Only a genuinely
  // new assignment attempt against an archived tag is rejected below.
  const existing = await client.tagAssignment.findFirst({
    where: { tagId, entityType, entityId },
  });
  if (existing) {
    return { ok: true, assignment: existing };
  }

  if (tag.archivedAt !== null) {
    return { ok: false, reason: "TAG_ARCHIVED" };
  }

  try {
    const assignment = await client.tagAssignment.create({
      data: { organizationId, tagId, entityType, entityId },
    });
    return { ok: true, assignment };
  } catch (err) {
    // Lost a race against a concurrent identical assignment — the DB's
    // own @@unique([tagId, entityType, entityId]) constraint is the real
    // guarantee here, exactly as required. Return the winner's row
    // rather than surfacing a spurious error to the caller.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await client.tagAssignment.findFirst({ where: { tagId, entityType, entityId } });
      if (winner) {
        return { ok: true, assignment: winner };
      }
    }
    throw err;
  }
}

export type UnassignTagResult = { ok: true } | { ok: false; reason: "TAG_NOT_FOUND" };

export async function unassignTag(
  organizationId: string,
  tagId: string,
  entityType: TagEntityType,
  entityId: string,
  client: PrismaClientOrTx = prisma,
): Promise<UnassignTagResult> {
  const tag = await client.tag.findFirst({ where: { id: tagId, organizationId }, select: { id: true } });
  if (!tag) {
    return { ok: false, reason: "TAG_NOT_FOUND" };
  }

  // Safe no-op whether or not an assignment actually existed — same
  // idempotent-unassign convention this codebase already uses elsewhere
  // for a redundant detach (e.g. removing a since-removed comment
  // mention link never errors either).
  await client.tagAssignment.deleteMany({ where: { organizationId, tagId, entityType, entityId } });
  return { ok: true };
}

export type GetTagsForEntityResult = { ok: true; tags: Tag[] } | { ok: false; reason: "ENTITY_NOT_FOUND" };

export async function getTagsForEntity(
  organizationId: string,
  entityType: TagEntityType,
  entityId: string,
  client: PrismaClientOrTx = prisma,
): Promise<GetTagsForEntityResult> {
  const ownsEntity = await assertTagEntityOwnership(organizationId, entityType, entityId, client);
  if (!ownsEntity) {
    return { ok: false, reason: "ENTITY_NOT_FOUND" };
  }

  const assignments = await client.tagAssignment.findMany({
    where: { organizationId, entityType, entityId },
    include: { tag: true },
    orderBy: { createdAt: "asc" },
  });
  return { ok: true, tags: assignments.map((a) => a.tag) };
}
