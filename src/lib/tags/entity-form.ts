import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { CustomStatusColor, TagEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { listTags } from "./definitions";
import { getTagsForEntity, assignTag, unassignTag } from "./assignments";

/**
 * Tags V2 (Staff UI) — reusable Client/Lead entity-form integration
 * helpers, mirroring src/lib/custom-fields/entity-form.ts's own exact
 * role: the ONE place the embedded "Tags" form section's own read/parse/
 * persist logic lives, so it isn't duplicated between the Client and Lead
 * create/edit Server Actions. Deliberately thin — every real tenant/
 * ownership/archived-state rule still lives in Phase 1's own
 * definitions.ts/assignments.ts, called here, never reimplemented.
 */

export type TagFormOption = { id: string; name: string; color: CustomStatusColor | null };

/** Every ACTIVE tag for this organization, position-independent (name order — see listTags' own default) — the checkbox picker's own option list. Archived tags are never offered here (Section 3: "no inline tag creation... existing archived assigned tags... not selectable for new assignment"). */
export async function getActiveTagFormOptions(
  organizationId: string,
  client: PrismaClientOrTx = prisma,
): Promise<TagFormOption[]> {
  const tags = await listTags(organizationId, {}, client);
  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color }));
}

export type ArchivedAssignedTagForUI = { id: string; name: string; color: CustomStatusColor | null };

export type TagFormAssignments = {
  /** ids of this entity's currently-assigned ACTIVE tags — the checkbox picker's own pre-checked state, and the "before" set persistTagAssignmentsInTransaction diffs a resubmission against. */
  activeTagIds: string[];
  /** This entity's currently-assigned tags whose OWN definition has since been archived — display-only (Section 3: "existing archived assigned tags must remain visible... but not selectable"). Never part of activeTagIds, never touched by a save — see persistTagAssignmentsInTransaction's own comment for why an archived assignment is structurally impossible to accidentally drop. */
  archivedAssigned: ArchivedAssignedTagForUI[];
};

/** This entity's current tag assignments, split into the active picker's pre-checked set and the archived, display-only set — used to prefill an edit form. `entityId` must already have been ownership-verified by the caller (every edit page in this app already re-verifies id+organizationId before rendering), matching getCustomFieldFormValues' own identical precondition. */
export async function getTagFormAssignments(
  organizationId: string,
  entityType: TagEntityType,
  entityId: string,
  client: PrismaClientOrTx = prisma,
): Promise<TagFormAssignments> {
  const result = await getTagsForEntity(organizationId, entityType, entityId, client);
  if (!result.ok) {
    // ENTITY_NOT_FOUND — structurally unreachable in normal use (the
    // caller already verified the entity exists in this organization
    // before calling this), but fails safe rather than throwing: an
    // empty form section is far better than a 500 for what would be a
    // pure defense-in-depth edge case.
    return { activeTagIds: [], archivedAssigned: [] };
  }

  const activeTagIds: string[] = [];
  const archivedAssigned: ArchivedAssignedTagForUI[] = [];
  for (const tag of result.tags) {
    if (tag.archivedAt === null) {
      activeTagIds.push(tag.id);
    } else {
      archivedAssigned.push({ id: tag.id, name: tag.name, color: tag.color });
    }
  }
  return { activeTagIds, archivedAssigned };
}

/**
 * Extracts exactly the submitted `tagIds` checkbox values, filtered down
 * to only ids that are among the given (already org-scoped, active)
 * options — Section 3: "no arbitrary tag IDs accepted without server
 * revalidation." A crafted `tagIds` value naming a foreign-org, archived,
 * or wholly invented tag id is simply dropped here before it ever reaches
 * persistTagAssignmentsInTransaction — matching
 * parseCustomFieldFormValues' own identical "never trust arbitrary
 * FormData" discipline. (assignTag itself independently re-verifies
 * tag/entity ownership again at write time regardless — this is only the
 * pre-check that keeps an invalid id from being attempted at all.)
 */
export function parseTagFormSelection(formData: FormData, activeOptions: TagFormOption[]): string[] {
  const submitted = formData.getAll("tagIds").filter((v): v is string => typeof v === "string");
  const validIds = new Set(activeOptions.map((o) => o.id));
  return [...new Set(submitted)].filter((id) => validIds.has(id));
}

/**
 * Diffs `submittedTagIds` against this entity's own current ACTIVE
 * assignments (`existingActiveTagIds` — from getTagFormAssignments, never
 * including an archived-tag assignment, which is never a member of
 * either set) and persists exactly the add/remove set, inside the
 * caller's own already-open transaction. An archived assignment is
 * therefore structurally impossible to drop via this diff: it was never
 * in `existingActiveTagIds` to begin with, so it can never appear in
 * `toRemove` (Section 3: "avoid silently dropping archived historical
 * assignments").
 *
 * Delegates entirely to Phase 1's own assignTag/unassignTag — never
 * duplicates tenant/ownership/archived-state validation here. Both
 * independently re-verify tag+entity ownership at write time regardless
 * of this module's own pre-filtering (parseTagFormSelection), matching
 * persistCustomFieldValuesInTransaction's own "defense in depth" precedent.
 */
export async function persistTagAssignmentsInTransaction(
  tx: Prisma.TransactionClient,
  {
    organizationId,
    entityType,
    entityId,
    existingActiveTagIds,
    submittedTagIds,
  }: {
    organizationId: string;
    entityType: TagEntityType;
    entityId: string;
    existingActiveTagIds: string[];
    submittedTagIds: string[];
  },
): Promise<void> {
  const existingSet = new Set(existingActiveTagIds);
  const submittedSet = new Set(submittedTagIds);

  const toAdd = submittedTagIds.filter((id) => !existingSet.has(id));
  const toRemove = existingActiveTagIds.filter((id) => !submittedSet.has(id));

  for (const tagId of toAdd) {
    const result = await assignTag(organizationId, tagId, entityType, entityId, tx);
    if (!result.ok) {
      // Should be unreachable in the ordinary case — parseTagFormSelection
      // already filtered submittedTagIds down to active, org-scoped tag
      // ids loaded moments earlier. A genuine race (the tag was archived,
      // or the entity itself removed, by a concurrent request between
      // that load and this write) surfaces loudly here and rolls the
      // whole transaction back, rather than silently committing a
      // half-written tag set — matching
      // persistCustomFieldValuesInTransaction's own identical contract.
      throw new Error(`Unexpected tag assignment failure for tag ${tagId}: ${result.reason}`);
    }
  }
  for (const tagId of toRemove) {
    await unassignTag(organizationId, tagId, entityType, entityId, tx);
  }
}
