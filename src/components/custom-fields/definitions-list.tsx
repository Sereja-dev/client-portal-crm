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
import { CreateDefinitionButton } from "./create-definition-button";
import { EditDefinitionButton } from "./edit-definition-dialog";
import {
  FieldTypeBadge,
  RequiredBadge,
  ArchiveDefinitionButton,
  UnarchiveDefinitionButton,
  MoveDefinitionButtons,
} from "./definition-row-actions";
import type { OptionRow } from "./option-manager";
import type { CustomFieldType } from "@/generated/prisma/enums";
import type { CustomFieldDefinitionFormState, CustomFieldOptionFormState } from "@/types";

export type DefinitionRow = {
  id: string;
  label: string;
  key: string;
  fieldType: CustomFieldType;
  required: boolean;
  archivedAt: Date | null;
  options: OptionRow[];
  editAction: (
    prevState: CustomFieldDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomFieldDefinitionFormState>;
  archiveAction: () => Promise<void>;
  unarchiveAction: () => Promise<void>;
  moveUpAction: () => Promise<void>;
  moveDownAction: () => Promise<void>;
  addOptionAction: (
    prevState: CustomFieldOptionFormState,
    formData: FormData,
  ) => Promise<CustomFieldOptionFormState>;
};

/**
 * Custom Fields Phase 2A (Section D/E) — the active/archived definitions
 * list for one entity tab. Mirrors src/components/clients/contacts-list.tsx's
 * own exact shape: local "show archived" toggle (both lists are fetched
 * once by the parent Server Component, filtered here), the same empty
 * states, the same responsive hidden-column strategy (no cramped
 * six-column table at 390px — Section S).
 */
export function DefinitionsList({
  definitions,
  createAction,
  entityLabel,
}: {
  definitions: DefinitionRow[];
  createAction: (
    prevState: CustomFieldDefinitionFormState,
    formData: FormData,
  ) => Promise<CustomFieldDefinitionFormState>;
  entityLabel: string;
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
          <CreateDefinitionButton action={createAction} entityLabel={entityLabel} />
        )}
      </div>

      {visibleDefinitions.length === 0 ? (
        showArchived ? (
          <EmptyState title="No archived custom fields" description="Archived custom fields will appear here." />
        ) : (
          <EmptyState
            title="No custom fields yet"
            description={`Add custom fields to capture information specific to your workflow for ${entityLabel.toLowerCase()}.`}
            action={<CreateDefinitionButton action={createAction} entityLabel={entityLabel} variant="primary" />}
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
                    <span>{definition.label}</span>
                    <FieldTypeBadge fieldType={definition.fieldType} />
                    {definition.required && <RequiredBadge />}
                  </div>
                  {definition.fieldType === "SELECT" && (
                    <p className="text-text-muted mt-0.5 text-xs">
                      {definition.options.filter((o) => o.archivedAt === null).length} option
                      {definition.options.filter((o) => o.archivedAt === null).length === 1 ? "" : "s"}
                    </p>
                  )}
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
                      <MoveDefinitionButtons
                        moveUpAction={definition.moveUpAction}
                        moveDownAction={definition.moveDownAction}
                        isFirst={index === 0}
                        isLast={index === visibleDefinitions.length - 1}
                        label={definition.label}
                      />
                    )}
                    {definition.archivedAt === null ? (
                      <>
                        <EditDefinitionButton
                          definitionId={definition.id}
                          label={definition.label}
                          required={definition.required}
                          fieldType={definition.fieldType}
                          entityLabel={entityLabel}
                          entityKey={definition.key}
                          action={definition.editAction}
                          options={definition.options}
                          addOptionAction={definition.addOptionAction}
                        />
                        <ArchiveDefinitionButton action={definition.archiveAction} label={definition.label} />
                      </>
                    ) : (
                      <UnarchiveDefinitionButton action={definition.unarchiveAction} label={definition.label} />
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
