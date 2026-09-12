"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { COLOR_TO_TONE } from "@/lib/custom-statuses/presentation";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";
import type { CustomStatusColor } from "@/generated/prisma/enums";

/**
 * Custom Statuses Phase 2B (Staff UI, Section D/H/I/K). Small badges +
 * row-level action buttons for one status definition — mirrors
 * custom-fields/definition-row-actions.tsx's own exact shapes
 * (FieldTypeBadge/RequiredBadge, ArchiveDefinitionButton/
 * UnarchiveDefinitionButton's ConfirmDialog+toast pattern,
 * MoveDefinitionButtons' plain-glyph up/down pair).
 */

/** Renders this definition's own current color as a real StatusBadge preview — the same presentation an entity's status badge would show, not a bare swatch. */
export function ColorPreviewBadge({ label, color }: { label: string; color: CustomStatusColor | null }) {
  const tone = color ? COLOR_TO_TONE[color] : "neutral";
  return <StatusBadge status={label} label={label} tone={tone} />;
}

export function SystemBadge() {
  return (
    <span className="bg-surface-muted text-text-secondary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      Built-in
    </span>
  );
}

export function DefaultBadge() {
  return (
    <span className="bg-info-subtle text-info inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      Default
    </span>
  );
}

export function ArchivedBadge() {
  return (
    <span className="bg-surface-recessed text-text-muted inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      Archived
    </span>
  );
}

export function SetDefaultButton({
  action,
  label,
}: {
  /** A bound, zero-argument server action (setDefaultCustomStatusAction.bind(null, entityType, definitionId)). */
  action: () => Promise<void>;
  label: string;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await action();
      showToast(`${label} is now the default`);
    } catch (err) {
      showToast(
        isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : err instanceof Error ? err.message : `Failed to set ${label} as default.`,
        "error",
      );
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
      Set default
    </button>
  );
}

export function ArchiveCustomStatusButton({
  action,
  label,
}: {
  /** A bound, zero-argument server action (archiveCustomStatusAction.bind(null, definitionId)). */
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
    } catch (err) {
      showToast(
        isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : err instanceof Error ? err.message : `Failed to archive ${label}.`,
        "error",
      );
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
        title="Archive status"
        description={
          <>
            Archive <span className="text-text-primary font-medium">{label}</span>? Existing
            records keep this status, but it will no longer be available for new
            assignments. You can unarchive it again at any time.
          </>
        }
        confirmLabel="Archive"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function UnarchiveCustomStatusButton({
  action,
  label,
}: {
  /** A bound, zero-argument server action (unarchiveCustomStatusAction.bind(null, definitionId)). */
  action: () => Promise<void>;
  label: string;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await action();
      showToast(`${label} restored to active statuses`);
    } catch (err) {
      showToast(
        isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : err instanceof Error ? err.message : `Failed to restore ${label}.`,
        "error",
      );
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

/** Simple deterministic "Move up"/"Move down" pair (Section K) — no drag/drop. Byte-for-byte mirror of custom-fields/definition-row-actions.tsx's own MoveDefinitionButtons. */
export function MoveCustomStatusButtons({
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
    } catch (err) {
      showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : `Failed to move ${label}.`, "error");
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
