"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast/toast-provider";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";
import type { RowActionResult, DuplicateInvoiceTemplateActionResult } from "@/app/(dashboard)/settings/invoice-templates/actions";

const FORBIDDEN_MESSAGE = "You don't have permission to do that.";

/**
 * Invoice Templates V1 — row-level Duplicate/Archive/Restore, one small
 * component per action. Mirrors
 * src/components/quote-templates/quote-template-row-actions.tsx's own
 * identical shape exactly (same confirm-before-archive, no-confirm-
 * restore/duplicate split, same wording pattern with "invoice" in place
 * of "quote").
 */

export function ArchiveTemplateButton({ templateId, name, action }: { templateId: string; name: string; action: (templateId: string) => Promise<RowActionResult> }) {
  const router = useRouter();
  const { showToast } = useToast();
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      const result = await action(templateId);
      if (result.ok) {
        showToast(`${name} archived`);
        router.refresh();
        return;
      }
      showToast(result.reason === "FORBIDDEN" ? FORBIDDEN_MESSAGE : "This template could not be found — it may have already been removed.", "error");
      router.refresh();
    } catch (err) {
      showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : `Failed to archive ${name}.`, "error");
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
        title="Archive invoice template"
        description={
          <>
            Archive <span className="text-text-primary font-medium">{name}</span>? It will no longer be
            offered when starting a new invoice. Existing invoices already created from it are not affected,
            and you can restore it to active at any time.
          </>
        }
        confirmLabel="Archive"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function RestoreTemplateButton({ templateId, name, action }: { templateId: string; name: string; action: (templateId: string) => Promise<RowActionResult> }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const result = await action(templateId);
      if (result.ok) {
        showToast(`${name} restored to active templates`);
        router.refresh();
        return;
      }
      showToast(result.reason === "FORBIDDEN" ? FORBIDDEN_MESSAGE : "This template could not be found — it may have already been removed.", "error");
      router.refresh();
    } catch (err) {
      showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : `Failed to restore ${name}.`, "error");
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
      Restore
    </button>
  );
}

/**
 * Opens the new copy for review/edit on success — same UX choice
 * duplicateQuoteTemplate's own row action already made (see that
 * component's own comment) — rather than staying on the list, so the
 * actor can immediately confirm/adjust the copy before it's used.
 */
export function DuplicateTemplateButton({
  templateId,
  name,
  action,
}: {
  templateId: string;
  name: string;
  action: (templateId: string) => Promise<DuplicateInvoiceTemplateActionResult>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const result = await action(templateId);
      if (result.ok) {
        showToast(`${name} duplicated`);
        router.push(`/settings/invoice-templates/${result.newTemplateId}`);
        return;
      }
      showToast(result.reason === "FORBIDDEN" ? FORBIDDEN_MESSAGE : "This template could not be found — it may have already been removed.", "error");
      router.refresh();
    } catch (err) {
      showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : `Failed to duplicate ${name}.`, "error");
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
      Duplicate
    </button>
  );
}
