"use client";

import { TagChip } from "./tag-chip";
import type { CustomStatusColor } from "@/generated/prisma/enums";

/**
 * Tags V2 (Section 3) — the "Tags" section embedded, identically, into
 * ClientForm/LeadForm's own `<form>` (never a separate `<form>` of its
 * own — mirrors custom-fields/custom-fields-form-section.tsx's own exact
 * embedding pattern). Every checkbox submits as `tagIds` in the same
 * FormData the entity's normal fields already use; the Server Action
 * layer re-validates every submitted id server-side (see
 * src/lib/tags/entity-form.ts's own parseTagFormSelection) — nothing
 * here is trusted on its own.
 *
 * Renders nothing at all when there's genuinely nothing to show (no
 * active org tags AND no archived tag already on this record) — matches
 * CustomFieldsFormSection's own "render nothing when empty" precedent.
 */

export type TagFormOptionForUI = { id: string; name: string; color: CustomStatusColor | null };
export type ArchivedAssignedTagForUI = { id: string; name: string; color: CustomStatusColor | null };

export function TagsFormSection({
  options,
  selectedTagIds = [],
  archivedAssigned = [],
}: {
  /** Every ACTIVE org tag — the picker's own selectable set. */
  options: TagFormOptionForUI[];
  /** Edit only — this entity's own currently-assigned ACTIVE tag ids, pre-checking the matching checkboxes. Always empty on create. */
  selectedTagIds?: string[];
  /** Edit only — this entity's own currently-assigned tags whose definition has since been archived: shown so history isn't silently hidden, but never as a checkbox — there is no way to newly select one, and unchecking is impossible since it was never rendered as checked in the first place (Section 3: "not selectable for new assignment"). */
  archivedAssigned?: ArchivedAssignedTagForUI[];
}) {
  if (options.length === 0 && archivedAssigned.length === 0) {
    return null;
  }

  return (
    <fieldset className="border-border-default space-y-3 border-t pt-4">
      <legend className="text-text-primary text-base font-semibold">Tags</legend>

      {options.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {options.map((tag) => (
            <label key={tag.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="tagIds"
                value={tag.id}
                defaultChecked={selectedTagIds.includes(tag.id)}
                className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              />
              <TagChip name={tag.name} color={tag.color} />
            </label>
          ))}
        </div>
      ) : (
        <p className="text-text-muted text-xs">
          No tags yet — create some from Settings → Tags.
        </p>
      )}

      {archivedAssigned.length > 0 && (
        <div>
          <p className="text-text-muted text-xs">
            Already on this record, but archived — kept, and can&apos;t be added to anything else:
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {archivedAssigned.map((tag) => (
              <TagChip key={tag.id} name={tag.name} color={tag.color} archived />
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}
