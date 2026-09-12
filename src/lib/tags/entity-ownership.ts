import "server-only";
import type { TagEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";

/**
 * Tags V1 Phase 1 — independent tenant-ownership verification for the
 * entity side of a TagAssignment. Mirrors
 * src/lib/custom-fields/entity-ownership.ts's own
 * assertCustomFieldEntityOwnership exactly: a plain `findFirst({where:
 * {id, organizationId}})` per entity type.
 *
 * This is deliberately how the legacy nullable `Client.organizationId`
 * case is handled — NOT via an explicit `!== null` check anywhere, but
 * structurally: Prisma compiles `{organizationId}` in a `where` clause to
 * a SQL `organizationId = $1` comparison, which can never match a row
 * whose actual column value is SQL NULL. A Client with a null
 * organizationId is therefore already indistinguishable from one that
 * belongs to a different org — both come back as "not found" here, and
 * neither can ever receive a Tag. Ownership is never inferred through
 * any other relation (e.g. an assigned Project or a Lead's conversion
 * link) — only this entity's own stored organizationId column counts.
 */

export type TagAssignableEntityType = TagEntityType;

export async function assertTagEntityOwnership(
  organizationId: string,
  entityType: TagAssignableEntityType,
  entityId: string,
  client: PrismaClientOrTx = prisma,
): Promise<boolean> {
  switch (entityType) {
    case "CLIENT": {
      const row = await client.client.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
      return row !== null;
    }
    case "LEAD": {
      const row = await client.lead.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
      return row !== null;
    }
    default: {
      const _exhaustive: never = entityType;
      return _exhaustive;
    }
  }
}
