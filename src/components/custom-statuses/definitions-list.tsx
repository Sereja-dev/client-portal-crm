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
import { CreateStatusButton } from "./create-status-button";
import { EditStatusButton } from "./edit-status-dialog";
import {
  ColorPreviewBadge,
  SystemBadge,
  DefaultBadge,
  ArchivedBadge,
  SetDefaultButton,
  ArchiveCustomStatusButton,
  UnarchiveCustomStatusButton,
  MoveCustomStatusButtons,
} from "./status-row-actions";
import type { CustomStatusColor } from "@/generated/prisma/enums";
import type { CustomStatusDefinitionFormState } from "@/types";

export type StatusDefinitionRow = {
  id: string;
  label: string;
  key: string;
  color: CustomStatusColor | null;
  isSystem: boolean;
  isDefault: boolean;
  archivedAt: Date | null;
  editAction: (
    prevState: CustomStatusDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomStatusDefinitionFormState>;
  archiveAction: () => Promise<void>;
  unarchiveAction: () => Promise<void>;
  setDefaultAction: () => Promise<void>;
  moveUpAction: () => Promise<void>;
  moveDownAction: () => Promise<void>;
};

/**
 * Custom Statuses Phase 2B (Section D/E). The active/archived definitions
 * list for one entity tab — mirrors custom-fields/definitions-list.tsx's
 * own exact shape: local "show archived" toggle (both lists fetched once
 * by the parent Server Component), same empty states, same responsive
 * hidden-column strategy (Section U: no cramped table at 390px — internal
 * key hidden below `sm`, position hidden below `md`). Raw UUIDs are never
 * rendered (Section D) — only the stable `key`, never `id`.
 *
 * System definitions render in the same ordered list as custom ones
 * (Section K: "System + custom statuses share one ordered list") but
 * never get an Edit or Archive control (Section E) — only Move and,
 * when not already the default, Set default.
 */
export function DefinitionsList({
  definitions,
  createAction,
  entityLabel,
  canSetDefault,
}: {
  definitions: StatusDefinitionRow[];
  createAction: (
    prevState: CustomStatusDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomStatusDefinitionFormState>;
  entityLabel: string;
  /** Phase 2B Completion Pass (Section B/C) — false only for LEAD: its default is permanently locked to the system NEW definition, so no row (system or custom) ever offers "Set default" here, and the create dialog never renders the "make default" checkbox. */
  canSetDefault: boolean;
}) {
  const [showArchived, setShowArchived] = useState(false);

  const activeDefinitions = definitions.filter((d) => d.archivedAt === null);
  const archivedDefinitions = definitions.filter((d) => d.archivedAt !== null);
  const visibleDefinitions = showArchived ? archivedDefinitions : activeDefinitions;

  return (
    <div>
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {(archivedDefinitions.length > 0 || showArchived) && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {showArchived ? "Show active" : `Show archived (${archivedDefinitions.length})`}
            </button>
          )}
        </div>
        {activeDefinitions.length > 0 && !showArchived && (
          <CreateStatusButton action={createAction} entityLabel={entityLabel} canSetDefault={canSetDefault} />
        )}
      </div>

      {visibleDefinitions.length === 0 ? (
        showArchived ? (
          <EmptyState title="No archived statuses" description="Archived statuses will appear here." />
        ) : (
          <EmptyState
            title="No statuses yet"
            description={`Add custom statuses for ${entityLabel.toLowerCase()} alongside the built-in ones.`}
            action={<CreateStatusButton action={createAction} entityLabel={entityLabel} canSetDefault={canSetDefault} variant="primary" />}
          />
        )
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Label</TableHeaderCell>
              <TableHeaderCell className="hidden sm:table-cell">Internal key</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell" align="right">
                Position
              </TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {visibleDefinitions.map((definition, index) => (
              <TableRow key={definition.id}>
                <TableCell emphasis>
                  <div className="flex flex-wrap items-center gap-2">
                    <ColorPreviewBadge label={definition.label} color={definition.color} />
                    {definition.isSystem && <SystemBadge />}
                    {definition.isDefault && <DefaultBadge />}
                    {definition.archivedAt !== null && <ArchivedBadge />}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <code className="text-text-muted text-xs">{definition.key}</code>
                </TableCell>
                <TableCell className="hidden md:table-cell" align="right">
                  {index + 1}
                </TableCell>
                <TableCell align="right">
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                    {!showArchived && (
                      <MoveCustomStatusButtons
                        moveUpAction={definition.moveUpAction}
                        moveDownAction={definition.moveDownAction}
                        isFirst={index === 0}
                        isLast={index === visibleDefinitions.length - 1}
                        label={definition.label}
                      />
                    )}
                    {definition.archivedAt === null ? (
                      <>
                        {!definition.isSystem && (
                          <EditStatusButton
                            label={definition.label}
                            color={definition.color}
                            entityLabel={entityLabel}
                            entityKey={definition.key}
                            isDefault={definition.isDefault}
                            canSetDefault={canSetDefault}
                            action={definition.editAction}
                            setDefaultAction={definition.setDefaultAction}
                          />
                        )}
                        {definition.isSystem && !definition.isDefault && canSetDefault && (
                          <SetDefaultButton action={definition.setDefaultAction} label={definition.label} />
                        )}
                        {!definition.isSystem && !definition.isDefault && (
                          <ArchiveCustomStatusButton action={definition.archiveAction} label={definition.label} />
                        )}
                      </>
                    ) : (
                      <UnarchiveCustomStatusButton action={definition.unarchiveAction} label={definition.label} />
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
