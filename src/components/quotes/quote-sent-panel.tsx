"use client";

import { useRef, useState } from "react";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { QuoteForm, type QuoteFormDefaults, type QuoteTargetOption } from "@/components/quotes/quote-form";
import { QuoteReadOnlyView } from "@/components/quotes/quote-read-only-view";
import { QuoteLifecycleControls } from "@/components/quotes/quote-lifecycle-controls";
import type { QuoteReadOnlyLineItem } from "@/components/quotes/quote-read-only-view";
import type { QuoteTargetDisplayInput } from "@/lib/quotes/target-display";
import type { UpdateQuoteResult } from "@/app/(dashboard)/quotes/actions";
import type { QuoteWritableInput } from "@/lib/validation/quote";

/**
 * Aqenra Quotes Phase 3 (Staff UI) §F/§G — a still-live SENT Quote (not
 * yet expired, not converted) is a real, distinct case from both DRAFT
 * (always directly editable, no gate — see the edit page's own DRAFT
 * branch) and every other non-editable status (APPROVED/DECLINED/
 * expired-SENT/converted, which never offer an edit path at all outside
 * Reopen). §G asks the read-only view to show the recipient snapshot for
 * a SENT Quote, so this defaults to that read-only presentation — but
 * §F also requires SENT to stay directly editable, so an "Edit quote"
 * trigger is offered, gated behind an explicit confirmation that spells
 * out the real consequence (saving resets this Quote to Draft and clears
 * who it was sent to) BEFORE the form itself appears — never a silent
 * mode switch. Once confirmed, this swaps entirely to the same QuoteForm
 * DRAFT/edit uses; there is no partial/inline-editable read-only hybrid.
 */
export function QuoteSentPanel({
  readOnly,
  formAction,
  formDefaults,
  leads,
  clients,
  currencyOptions,
  quoteId,
  archivedAt,
}: {
  readOnly: {
    number: string;
    validUntil: Date | null;
    convertedInvoiceId: string | null;
    target: QuoteTargetDisplayInput;
    title: string | null;
    issueDate: Date;
    recipientName: string | null;
    recipientEmail: string | null;
    lineItems: QuoteReadOnlyLineItem[];
    currency: string;
    subtotal: string;
    discountType: string;
    discountAmount: string | null;
    discountValue: string | null;
    taxRatePercent: string | null;
    taxAmount: string | null;
    taxLabel: string;
    total: string;
    notes: string | null;
  };
  formAction: (input: QuoteWritableInput) => Promise<UpdateQuoteResult>;
  formDefaults: QuoteFormDefaults;
  leads: QuoteTargetOption[];
  clients: QuoteTargetOption[];
  currencyOptions: readonly string[];
  quoteId: string;
  archivedAt: Date | null;
}) {
  const [editing, setEditing] = useState(false);
  const editDialogRef = useRef<ConfirmDialogHandle>(null);

  if (editing) {
    return (
      <>
        <p className="border-warning bg-warning-subtle text-warning mb-6 rounded-md border px-4 py-3 text-sm">
          Saving will move this quote back to Draft and clear the record of who it was sent to.
        </p>
        <QuoteForm
          action={formAction}
          leads={leads}
          clients={clients}
          currencyOptions={currencyOptions}
          defaultValues={formDefaults}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          successToast="Quote updated"
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <QuoteReadOnlyView status="SENT" convertedInvoice={null} {...readOnly} />
      <div className="border-border-default flex flex-wrap items-center gap-3 border-t pt-6">
        <Button type="button" variant="secondary" onClick={() => editDialogRef.current?.open()}>
          Edit quote
        </Button>
        <QuoteLifecycleControls
          quoteId={quoteId}
          status="SENT"
          validUntil={readOnly.validUntil}
          convertedInvoiceId={readOnly.convertedInvoiceId}
          archivedAt={archivedAt}
          clientId={null}
          projects={[]}
        />
      </div>
      <ConfirmDialog
        ref={editDialogRef}
        title="Edit sent quote"
        description="This quote has already been sent. Saving changes will move it back to Draft and clear the record of who it was sent to — you'll need to mark it as sent again."
        confirmLabel="Edit anyway"
        onConfirm={() => setEditing(true)}
      />
    </div>
  );
}
