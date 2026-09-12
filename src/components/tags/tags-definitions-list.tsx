"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { CreateTagButton } from "./create-tag-button";
import { EditTagButton } from "./edit-tag-dialog";
import { ArchiveTagButton } from "./tag-row-actions";
import { TagChip } from "./tag-chip";
import type { CustomStatusColor } from "@/generated/prisma/enums";
import type { TagFormState } from "@/types";

export type TagDefinitionRow = {
  id: string;
  name: string;
  color: CustomStatusColor | null;
  archivedAt: Date | null;
  editAction: (prevState: TagFormState, formData: FormData) => Promise<TagFormState>;
  archiveAction: () => Promise<void>;
};

/**
 * Tags V2 (Settings → Tags, Section 1). The active/archived tags list —
 * mirrors custom-statuses/definitions-list.tsx's own exact shape: local
 * "show archived" toggle (both lists fetched once by the parent Server
 * Component), same empty states. No position/key/system/default columns
 * at all — a Tag has none of those concepts (see Tag's own schema doc
 * comment: no entityType, no ordering, no built-ins).
 */
export function TagsDefinitionsList({
  tags,
  createAction,
}: {
  tags: TagDefinitionRow[];
  createAction: (prevState: TagFormState, formData: FormData) => Promise<TagFormState>;
}) {
  const [showArchived, setShowArchived] = useState(false);

  const activeTags = tags.filter((t) => t.archivedAt === null);
  const archivedTags = tags.filter((t) => t.archivedAt !== null);
  const visibleTags = showArchived ? archivedTags : activeTags;

  return (
    <div>
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {(archivedTags.length > 0 || showArchived) && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {showArchived ? "Show active" : `Show archived (${archivedTags.length})`}
            </button>
          )}
        </div>
        {activeTags.length > 0 && !showArchived && <CreateTagButton action={createAction} />}
      </div>

      {visibleTags.length === 0 ? (
        showArchived ? (
          <EmptyState title="No archived tags" description="Archived tags will appear here." />
        ) : (
          <EmptyState
            title="No tags yet"
            description="Add tags to organize and filter your clients and leads."
            action={<CreateTagButton action={createAction} />}
          />
        )
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Tag</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {visibleTags.map((tag) => (
              <TableRow key={tag.id}>
                <TableCell emphasis>
                  <TagChip name={tag.name} color={tag.color} />
                </TableCell>
                <TableCell align="right">
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                    {tag.archivedAt === null ? (
                      <>
                        <EditTagButton name={tag.name} color={tag.color} action={tag.editAction} />
                        <ArchiveTagButton action={tag.archiveAction} name={tag.name} />
                      </>
                    ) : (
                      <span className="text-text-muted text-xs">Archived</span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
