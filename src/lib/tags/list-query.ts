import "server-only";
import type { CustomStatusColor, TagEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";

/**
 * Tags V2 (Staff UI) — bulk, list-page-scoped reads. Distinct from
 * entity-form.ts's own single-entity helpers: these two functions exist
 * only for the Clients/Leads list pages (display + single-tag filtering)
 * and always operate over many entities/one tag at once, never one
 * entity's own form.
 *
 * Both functions query TagAssignment scoped by organizationId AND
 * entityType together, on every call, with no exception — the polymorphic
 * `entityId` column has no real foreign key (see TagAssignment's own
 * schema doc comment), so this pair is exactly what stands between a
 * crafted/foreign-org id and a cross-tenant leak.
 */

export type TagAssignmentDisplay = { id: string; name: string; color: CustomStatusColor | null; archived: boolean };

/**
 * Every currently-assigned tag for each of the given entityIds, grouped
 * by entityId, tag-name order — the Clients/Leads list pages' own
 * "Tags" column. Archived tags are included (marked `archived: true`),
 * never silently hidden — Section 4: "if an archived tag is still
 * assigned, display it distinctly but safely," never as if it were
 * active. Returns an empty map without querying at all when `entityIds`
 * is empty (an empty result page never issues a real
 * `entityId IN ()`-shaped query).
 */
export async function getTagsForEntities(
  organizationId: string,
  entityType: TagEntityType,
  entityIds: string[],
  client: PrismaClientOrTx = prisma,
): Promise<Map<string, TagAssignmentDisplay[]>> {
  const map = new Map<string, TagAssignmentDisplay[]>();
  if (entityIds.length === 0) {
    return map;
  }

  const assignments = await client.tagAssignment.findMany({
    where: { organizationId, entityType, entityId: { in: entityIds } },
    include: { tag: true },
    orderBy: { tag: { name: "asc" } },
  });

  for (const assignment of assignments) {
    const list = map.get(assignment.entityId) ?? [];
    list.push({
      id: assignment.tag.id,
      name: assignment.tag.name,
      color: assignment.tag.color,
      archived: assignment.tag.archivedAt !== null,
    });
    map.set(assignment.entityId, list);
  }

  return map;
}

/**
 * Every entityId currently tagged with `tagId`, for the single-tag list
 * filter (Section 5's own required two-step query: fetch matching
 * entityIds here, then fold them into the caller's own Client/Lead
 * `where`). A tampered/foreign-org tagId simply matches zero
 * TagAssignment rows (organizationId is always part of the where clause
 * here, and every real assignment row's own organizationId always
 * matches its tag's — Phase 1's own assignTag invariant) — this returns
 * an empty array rather than throwing or matching anything, so the
 * caller's own `id: { in: [] }` fold-in correctly yields zero rows
 * (Section 5: "if zero matching assignments, return an empty list
 * efficiently — do not accidentally remove the tag filter and show all
 * entities").
 */
export async function resolveTagAssignedEntityIds(
  organizationId: string,
  entityType: TagEntityType,
  tagId: string,
  client: PrismaClientOrTx = prisma,
): Promise<string[]> {
  const rows = await client.tagAssignment.findMany({
    where: { organizationId, entityType, tagId },
    select: { entityId: true },
  });
  return rows.map((row) => row.entityId);
}
