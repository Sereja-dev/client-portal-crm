"use client";

import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { DIALOG_CENTER_CLASSES } from "@/components/ui/dialog-classes";
import { useToast } from "@/components/toast/toast-provider";
import type { ConvertQuoteToInvoiceResult } from "@/app/(dashboard)/quotes/actions";

export type ConvertToInvoiceDialogHandle = { open: () => void };

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Quotes / Estimates Phase 3 (Staff UI) §L — a dedicated dialog, not a
 * reuse of the generic <ConfirmDialog> (same reasoning as
 * MarkLeadLostDialog's own header comment: this needs real, separately-
 * labeled form controls, not a plain description paragraph). Unlike
 * MarkLeadLostDialog, this dialog does NOT close itself before the async
 * call settles — convertQuoteToInvoiceAction's own controlled failures
 * (duplicate_invoice_number, already_converted, invalid_transition,
 * invalid_target, no_client, validation) must stay visible inside this
 * same dialog so the user can correct the Invoice number or Project and
 * retry without reopening it. Only a genuine success closes it.
 *
 * Only ever rendered by the page when status === APPROVED,
 * convertedInvoiceId === null, and clientId is present (§L) — this
 * component itself does not re-check those; it exists to collect exactly
 * the two allowed inputs (Invoice number, optional Project) and submit
 * them, nothing else. Client/organizationId/totals/line items are never
 * asked for here — all server-derived (§L), matching
 * convertQuoteToInvoiceAction's own narrow input contract exactly.
 */
export function ConvertToInvoiceDialog({
  ref,
  quoteId,
  projects,
  action,
}: {
  ref?: Ref<ConvertToInvoiceDialogHandle>;
  quoteId: string;
  /** Only same-org Projects belonging to this Quote's own Client (§L) — filtered by the page before this component ever sees them. */
  projects: { id: string; name: string }[];
  action: (quoteId: string, invoiceNumber: string, projectId: string | null) => Promise<ConvertQuoteToInvoiceResult>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const numberFieldId = useId();
  const projectFieldId = useId();

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [projectId, setProjectId] = useState("");
  const [numberError, setNumberError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      setInvoiceNumber("");
      setProjectId("");
      setNumberError(undefined);
      setSubmitting(false);
      dialogRef.current?.showModal();
    },
  }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setNumberError(undefined);
    setSubmitting(true);

    const result = await action(quoteId, invoiceNumber, projectId || null);
    setSubmitting(false);

    if (result.ok) {
      dialogRef.current?.close();
      showToast("Quote converted to invoice");
      router.push(`/invoices/${result.invoiceId}/edit`);
      return;
    }

    switch (result.reason) {
      case "validation":
        setNumberError(result.fieldErrors.invoiceNumber ?? "Enter a valid invoice number.");
        return;
      case "duplicate_invoice_number":
        setNumberError("An invoice with this number already exists.");
        return;
      case "invalid_target":
        showToast("That project doesn't belong to this quote's client. Choose a different project.", "error");
        return;
      case "already_converted":
        showToast("This quote has already been converted to an invoice.", "error");
        dialogRef.current?.close();
        router.refresh();
        return;
      case "invalid_transition":
        showToast("This quote can no longer be converted — it may have changed elsewhere.", "error");
        dialogRef.current?.close();
        router.refresh();
        return;
      case "no_client":
        showToast("This quote has no client to invoice yet.", "error");
        dialogRef.current?.close();
        return;
      case "not_found":
        showToast("This quote could not be found — it may have been removed.", "error");
        dialogRef.current?.close();
        router.refresh();
        return;
      case "rate_limited":
        showToast("Too many requests. Please try again later.", "error");
        return;
      default:
        showToast(GENERIC_ERROR, "error");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      className={`border-border-default bg-surface w-full max-w-sm rounded-lg border p-6 shadow-xl backdrop:bg-black/40 ${DIALOG_CENTER_CLASSES}`}
    >
      <h2 id={titleId} className="text-text-primary text-base font-semibold">
        Convert to invoice
      </h2>
      <p className="text-text-secondary mt-2 text-sm">
        Creates a new draft invoice from this quote&rsquo;s own totals and line items. The client and amounts are carried
        over automatically.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <FormField label="Invoice number" htmlFor={numberFieldId} required error={numberError}>
          <Input
            id={numberFieldId}
            value={invoiceNumber}
            onChange={(event) => {
              setInvoiceNumber(event.target.value);
              setNumberError(undefined);
            }}
            required
            aria-invalid={!!numberError}
            aria-describedby={numberError ? `${numberFieldId}-error` : undefined}
          />
        </FormField>

        <FormField label="Project" htmlFor={projectFieldId}>
          <Select id={projectFieldId} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            Convert
          </Button>
        </div>
      </form>
    </dialog>
  );
}
