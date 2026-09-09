"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { FIELD_TYPE_LABELS } from "@/lib/validation/custom-field";
import type { CustomFieldType } from "@/generated/prisma/enums";

/**
 * Custom Fields Phase 2A (Staff UI). Small badges + row-level action
 * buttons for one Definition row — mirrors src/components/clients/
 * contact-row-actions.tsx's own exact shapes (PrimaryBadge/BillingBadge,
 * ArchiveContactButton/UnarchiveContactButton's ConfirmDialog+toast
 * pattern) since this is the same "small semantic badge + confirm-then-
 * toast row action" problem applied to a different list.
 */

export function FieldTypeBadge({ fieldType }: { fieldType: CustomFieldType }) {
  return (
    <span className="bg-surface-muted text-text-secondary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      {FIELD_TYPE_LABELS[fieldType]}
    </span>
  );
}

export function RequiredBadge() {
  return (
    <span className="bg-warning-subtle text-warning inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      Required
    </span>
  );
}

export function ArchiveDefinitionButton({
  action,
  label,
}: {
  /** A bound, zero-argument server action (archiveDefinitionAction.bind(null, definitionId)). */
  action: () => Promise<void>;
  label: string;
}) {
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await action();
      showToast(`${label} archived`);
    } catch {
      showToast(`Failed to archive ${label}.`, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => dialogRef.current?.open()}
        className="text-danger focus-visible:ring-danger rounded text-sm font-medium whitespace-nowrap transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Archive
      </button>
      <ConfirmDialog
        ref={dialogRef}
        title="Archive custom field"
        description={
          <>
            Archive <span className="text-text-primary font-medium">{label}</span>? It will
            no longer appear as an active field once entity forms show custom fields.
            Existing values already saved for it are retained, not deleted, and you can
            unarchive it again at any time.
          </>
        }
        confirmLabel="Archive"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function UnarchiveDefinitionButton({
  action,
  label,
}: {
  /** A bound, zero-argument server action (unarchiveDefinitionAction.bind(null, definitionId)). */
  action: () => Promise<void>;
  label: string;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await action();
      showToast(`${label} restored to active custom fields`);
    } catch {
      showToast(`Failed to restore ${label}.`, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleClick}
      className={`${ACTION_LINK_CLASSES} whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60`}
    >
      Unarchive
    </button>
  );
}

/**
 * Simple deterministic "Move up"/"Move down" pair (Section I) — no
 * drag/drop. Plain unicode arrows, same lightweight-glyph-button
 * precedent ContactFormDialog's own "✕" close button already
 * establishes, rather than adding new SVG icons for this one use.
 * `isFirst`/`isLast` disable (not hide) the boundary button — its
 * presence-but-disabled state communicates "this is the top/bottom of
 * the list" more clearly than the button disappearing would.
 */
export function MoveDefinitionButtons({
  moveUpAction,
  moveDownAction,
  isFirst,
  isLast,
  label,
}: {
  moveUpAction: () => Promise<void>;
  moveDownAction: () => Promise<void>;
  isFirst: boolean;
  isLast: boolean;
  label: string;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState<"up" | "down" | null>(null);

  async function handleMove(direction: "up" | "down", action: () => Promise<void>) {
    setPending(direction);
    try {
      await action();
    } catch {
      showToast(`Failed to move ${label}.`, "error");
    } finally {
      setPending(null);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={isFirst || pending !== null}
        onClick={() => handleMove("up", moveUpAction)}
        aria-label={`Move ${label} up`}
        className="text-text-secondary focus-visible:ring-focus-ring hover:text-text-primary rounded px-1.5 py-0.5 text-sm transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ↑
      </button>
      <button
        type="button"
        disabled={isLast || pending !== null}
        onClick={() => handleMove("down", moveDownAction)}
        aria-label={`Move ${label} down`}
        className="text-text-secondary focus-visible:ring-focus-ring hover:text-text-primary rounded px-1.5 py-0.5 text-sm transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ↓
      </button>
    </span>
  );
}
