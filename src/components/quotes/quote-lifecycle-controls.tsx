"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { ConvertToInvoiceDialog, type ConvertToInvoiceDialogHandle } from "@/components/quotes/convert-to-invoice-dialog";
import { useToast } from "@/components/toast/toast-provider";
import {
  reopenQuoteAction,
  archiveQuoteAction,
  unarchiveQuoteAction,
  convertQuoteToInvoiceAction,
} from "@/app/(dashboard)/quotes/actions";
import { isQuoteConverted, isQuoteExpired } from "@/lib/quotes/status";
import type { QuoteStatusValue } from "@/lib/validation/quote";

const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Quotes / Estimates Phase 3 (Staff UI) §H/§I/§J/§L — the lifecycle
 * action surface for an existing, non-DRAFT-form Quote (i.e. rendered
 * alongside QuoteReadOnlyView). "Mark as sent" (§H) is deliberately NOT
 * here — that transition only ever applies to a DRAFT Quote, which never
 * reaches this component at all (a DRAFT Quote always shows the editable
 * QuoteForm instead); see QuoteSendControl, rendered by the edit page
 * directly alongside that still-live form, matching Invoice's own
 * InvoiceDraftPanel precedent of keeping the Issue/Send controls beside
 * the form rather than duplicating them into the read-only surface.
 */
export function QuoteLifecycleControls({
  quoteId,
  status,
  validUntil,
  convertedInvoiceId,
  archivedAt,
  clientId,
  projects,
}: {
  quoteId: string;
  status: QuoteStatusValue;
  validUntil: Date | null;
  convertedInvoiceId: string | null;
  archivedAt: Date | null;
  /** Only present when status === APPROVED and not yet converted — the page never passes this otherwise. */
  clientId: string | null;
  /** Only same-org Projects belonging to `clientId` — pre-filtered by the page (§L). */
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const archiveDialogRef = useRef<ConfirmDialogHandle>(null);
  const convertDialogRef = useRef<ConvertToInvoiceDialogHandle>(null);

  const converted = isQuoteConverted({ convertedInvoiceId });
  const expired = isQuoteExpired({ status, validUntil });
  const isArchived = archivedAt !== null;

  const canReopen = !converted && (status === "DECLINED" || (status === "SENT" && expired));
  const canConvert = !converted && status === "APPROVED" && clientId !== null;

  function runReopen() {
    startTransition(async () => {
      const result = await reopenQuoteAction(quoteId);
      if (result.ok) {
        showToast("Quote reopened as a draft");
        router.refresh();
        return;
      }
      if (result.reason === "rate_limited") {
        showToast(RATE_LIMIT_MESSAGE, "error");
      } else {
        showToast("This quote could not be reopened — it may have changed elsewhere. Refresh and try again.", "error");
        router.refresh();
      }
    });
  }

  function runArchiveToggle(archive: boolean) {
    startTransition(async () => {
      const result = archive ? await archiveQuoteAction(quoteId) : await unarchiveQuoteAction(quoteId);
      if (result.ok) {
        showToast(archive ? "Quote archived" : "Quote unarchived");
        router.refresh();
        return;
      }
      if (result.reason === "rate_limited") {
        showToast(RATE_LIMIT_MESSAGE, "error");
      } else {
        showToast(GENERIC_ERROR, "error");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canReopen && (
        <Button type="button" variant="secondary" disabled={pending} loading={pending} onClick={runReopen}>
          Reopen quote
        </Button>
      )}
      {canConvert && (
        <>
          <Button type="button" onClick={() => convertDialogRef.current?.open()}>
            Convert to invoice
          </Button>
          <ConvertToInvoiceDialog
            ref={convertDialogRef}
            quoteId={quoteId}
            projects={projects}
            action={convertQuoteToInvoiceAction}
          />
        </>
      )}
      {isArchived ? (
        <Button type="button" variant="secondary" disabled={pending} onClick={() => runArchiveToggle(false)}>
          Unarchive
        </Button>
      ) : (
        <>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => archiveDialogRef.current?.open()}>
            Archive
          </Button>
          <ConfirmDialog
            ref={archiveDialogRef}
            title="Archive quote"
            description="Archived quotes are hidden from the default list. You can unarchive it later."
            confirmLabel="Archive"
            onConfirm={() => runArchiveToggle(true)}
          />
        </>
      )}
    </div>
  );
}
