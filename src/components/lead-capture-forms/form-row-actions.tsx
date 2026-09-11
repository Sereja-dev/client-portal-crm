"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";

/**
 * Public Lead Capture Forms Phase 2A (Staff UI). Small row-level action
 * buttons for one form — mirrors custom-statuses/status-row-actions.tsx's
 * own exact ConfirmDialog+toast+pending-state shapes (ArchiveCustomStatusButton/
 * UnarchiveCustomStatusButton) so Archive/Activate here behave and look
 * identically to every other Settings list in the app.
 */

export function ArchiveFormButton({ action, name }: { action: () => Promise<void>; name: string }) {
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await action();
      showToast(`${name} archived`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Failed to archive ${name}.`, "error");
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
        title="Archive form"
        description={
          <>
            Archive <span className="text-text-primary font-medium">{name}</span>? Its public link
            will stop accepting submissions immediately. You can unarchive it again at any time.
          </>
        }
        confirmLabel="Archive"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function UnarchiveFormButton({ action, name }: { action: () => Promise<void>; name: string }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await action();
      showToast(`${name} restored`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Failed to restore ${name}.`, "error");
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

/** A quick isActive toggle right from the list row — the same underlying setLeadCaptureFormActiveAction the create/edit form's own "Active" checkbox goes through, just without a metadata round trip. */
export function ActivateToggleButton({
  action,
  name,
  isActive,
}: {
  /** A bound, zero-argument server action (setLeadCaptureFormActiveAction.bind(null, formId, !isActive)). */
  action: () => Promise<void>;
  name: string;
  isActive: boolean;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await action();
      showToast(isActive ? `${name} deactivated` : `${name} activated`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Failed to update ${name}.`, "error");
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
      {isActive ? "Deactivate" : "Activate"}
    </button>
  );
}

/** Builds the public URL from the browser's own origin at click time — never hardcoded — same convention as team/copy-link-button.tsx's own CopyLinkButton. */
export function CopyPublicLinkButton({ publicToken }: { publicToken: string }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/forms/${publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      showToast("Public link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Couldn't copy the link", "error");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`${ACTION_LINK_CLASSES} whitespace-nowrap`}
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
