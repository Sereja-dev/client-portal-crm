import { TagChip } from "./tag-chip";
import type { TagAssignmentDisplay } from "@/lib/tags/list-query";

/**
 * Tags V2 (Section 4) — the Clients/Leads list pages' own "Tags" column/
 * card field. Wraps within a bounded width rather than letting a row with
 * many tags grow arbitrarily wide or tall in one direction: chips wrap
 * onto further lines (`flex-wrap`) up to `max`, and any remainder past
 * that collapses into a plain "+N more" label instead of rendering
 * indefinitely — so one heavily-tagged record can never blow out the
 * table's own row height or the page's horizontal layout.
 */
export function TagChipList({ tags, max = 4 }: { tags: TagAssignmentDisplay[]; max?: number }) {
  if (tags.length === 0) {
    return <span className="text-text-muted text-sm">—</span>;
  }

  const visible = tags.slice(0, max);
  const hiddenCount = tags.length - visible.length;

  return (
    <div className="flex max-w-[16rem] flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <TagChip key={tag.id} name={tag.name} color={tag.color} archived={tag.archived} />
      ))}
      {hiddenCount > 0 && <span className="text-text-muted text-xs whitespace-nowrap">+{hiddenCount} more</span>}
    </div>
  );
}
