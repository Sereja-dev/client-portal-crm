"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { InvoiceLineItemRow } from "@/components/invoices/invoice-line-item-row";
import { useToast } from "@/components/toast/toast-provider";
import { withToast } from "@/lib/toast-url";
import { INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS } from "@/lib/validation/invoice";
import { calculateQuoteTotals } from "@/lib/quotes/calculations";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import type { InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import type { QuoteFieldErrors, QuoteItemErrors, QuoteWritableInput } from "@/lib/validation/quote";
import type { CreateQuoteResult, UpdateQuoteResult } from "@/app/(dashboard)/quotes/actions";

const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

const BLANK_LINE_ITEM: InvoiceLineItemFormValue = { description: "", quantity: "", unitPrice: "" };

export type QuoteTargetOption = { id: string; label: string };

export type QuoteFormDefaults = {
  number?: string;
  title?: string;
  /**
   * Which target the form should default its radio to — see quote-form's
   * own header comment for why this matters far more than it looks like
   * it should for an already-reconciled Quote (both leadId and clientId
   * set): defaulting to "lead" here, not "client", is what keeps a no-op
   * save from silently dropping the Lead lineage. The page building these
   * defaults is responsible for setting this to "lead" whenever the
   * source Quote's own leadId is non-null, regardless of clientId.
   */
  targetType?: "lead" | "client";
  leadId?: string;
  clientId?: string;
  issueDate?: string;
  validUntil?: string;
  currency?: string;
  notes?: string;
  discountType?: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue?: string;
  taxRatePercent?: string;
  taxLabel?: "TAX" | "VAT" | "GST";
  items?: InvoiceLineItemFormValue[];
};

/**
 * Quotes / Estimates Phase 3 (Staff UI) — the single Create/Edit Quote
 * form. Deliberately NOT built on useActionState/FormData the way
 * InvoiceForm is: createQuoteAction/updateQuoteAction (Phase 2) already
 * take a plain, already-typed QuoteWritableInput object rather than
 * FormData — their own header comment says exactly this was left open
 * "so a future form layer can adopt whichever shape it needs" — so this
 * component calls `action` directly inside startTransition and manages
 * fieldErrors/itemErrors as local state instead. QuoteItem stays entirely
 * separate from InvoiceLineItem at the persistence layer (each action's
 * own transaction writes only its own table) — reusing InvoiceLineItemRow
 * here is purely a UI-shape reuse (the component takes a generic
 * {description, quantity, unitPrice} value and has no Invoice-specific
 * logic of its own), never a coupling to Invoice persistence.
 *
 * Target: an explicit two-way radio (never two simultaneously "active"
 * selects) — changing it clears the inactive side's value immediately,
 * client-side, and only the active side's id is ever included in the
 * submitted input; the server (resolveQuoteTarget) is still the real
 * authority regardless.
 */
export function QuoteForm({
  action,
  leads,
  clients,
  currencyOptions,
  currencyFallbackNotice,
  defaultValues,
  submitLabel = "Save quote",
  pendingLabel = "Saving…",
  successToast,
}: {
  action: (input: QuoteWritableInput) => Promise<CreateQuoteResult | UpdateQuoteResult>;
  leads: QuoteTargetOption[];
  clients: QuoteTargetOption[];
  currencyOptions: readonly string[];
  currencyFallbackNotice?: string;
  defaultValues?: QuoteFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
  /**
   * The toast message to show after a successful save, on the way back
   * to /quotes — a plain string, not a callback: this component is
   * always rendered from a Server Component page (new/page.tsx,
   * [id]/edit/page.tsx), and only a real Server Action reference (never
   * an arbitrary closure) can cross that boundary as a prop. Navigation
   * itself always uses router.push (this is a Client Component; `action`
   * itself returns a discriminated-union result, never a redirect —
   * calling next/navigation's own `redirect()` from client code is not
   * the supported pattern useRouter().push() already is here).
   */
  successToast: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [fieldErrors, setFieldErrors] = useState<QuoteFieldErrors>({});
  const [itemErrors, setItemErrors] = useState<QuoteItemErrors>({});

  const [targetType, setTargetType] = useState<"lead" | "client" | null>(defaultValues?.targetType ?? null);
  const [leadId, setLeadId] = useState(defaultValues?.leadId ?? "");
  const [clientId, setClientId] = useState(defaultValues?.clientId ?? "");

  const [number, setNumber] = useState(defaultValues?.number ?? "");
  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [issueDate, setIssueDate] = useState(defaultValues?.issueDate ?? "");
  const [validUntil, setValidUntil] = useState(defaultValues?.validUntil ?? "");
  const [currency, setCurrency] = useState(defaultValues?.currency ?? currencyOptions[0] ?? "USD");
  const [notes, setNotes] = useState(defaultValues?.notes ?? "");
  const [discountType, setDiscountType] = useState<"NONE" | "PERCENTAGE" | "FIXED">(
    defaultValues?.discountType ?? "NONE",
  );
  const [discountValue, setDiscountValue] = useState(defaultValues?.discountValue ?? "");
  const [taxRatePercent, setTaxRatePercent] = useState(defaultValues?.taxRatePercent ?? "");
  const [taxLabel, setTaxLabel] = useState<"TAX" | "VAT" | "GST">(defaultValues?.taxLabel ?? "TAX");
  const [items, setItems] = useState<InvoiceLineItemFormValue[]>(
    defaultValues?.items && defaultValues.items.length > 0 ? defaultValues.items : [BLANK_LINE_ITEM],
  );

  function dismissErrors() {
    setFieldErrors({});
    setItemErrors({});
  }

  function handleTargetTypeChange(next: "lead" | "client") {
    setTargetType(next);
    // Clearing the inactive side immediately means the submitted input
    // below can never carry a stale, no-longer-visible id from the other
    // selector — this is a UX safeguard only; resolveQuoteTarget() is the
    // real, server-side authority regardless.
    if (next === "lead") {
      setClientId("");
    } else {
      setLeadId("");
    }
    dismissErrors();
  }

  function updateItem(index: number, next: InvoiceLineItemFormValue) {
    setItems((current) => current.map((item, i) => (i === index ? next : item)));
    dismissErrors();
  }
  function addItem() {
    setItems((current) => [...current, { ...BLANK_LINE_ITEM }]);
    dismissErrors();
  }
  function removeItem(index: number) {
    setItems((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current));
    dismissErrors();
  }
  function moveItem(index: number, direction: -1 | 1) {
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    dismissErrors();
  }

  // Preview only — calculateQuoteTotals is the exact same pure function
  // the server calls; the server's own recomputed result is always what
  // actually gets persisted and is never trusted to match this preview.
  const preview = calculateQuoteTotals({
    subtotalSource: { mode: "lineItems", lineItems: items },
    discount: discountType === "NONE" ? { type: "NONE" } : { type: discountType, value: discountValue },
    taxRatePercent: taxRatePercent === "" ? null : taxRatePercent,
  });
  const previewText = preview.ok ? formatInvoiceCurrencyAmount(preview.total, currency) : null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    dismissErrors();

    if (!targetType) {
      setFieldErrors({ target: "Select a lead or a client." });
      return;
    }

    const input: QuoteWritableInput = {
      number,
      title: title || undefined,
      leadId: targetType === "lead" ? leadId : undefined,
      clientId: targetType === "client" ? clientId : undefined,
      issueDate,
      validUntil: validUntil || undefined,
      currency,
      notes: notes || undefined,
      discountType,
      discountValue: discountType === "NONE" ? undefined : discountValue,
      taxRatePercent: taxRatePercent || undefined,
      taxLabel,
      items,
    };

    startTransition(async () => {
      const result = await action(input);
      if (result.ok) {
        router.push(withToast("/quotes", successToast));
        return;
      }
      switch (result.reason) {
        case "validation":
          setFieldErrors(result.fieldErrors);
          setItemErrors(result.itemErrors ?? {});
          return;
        case "invalid_target":
          setFieldErrors({ target: "Select a valid lead or client." });
          return;
        case "duplicate_quote_number":
          setFieldErrors({ number: "A quote with this number already exists." });
          return;
        case "rate_limited":
          showToast(RATE_LIMIT_MESSAGE, "error");
          return;
        case "not_found":
          showToast("This quote could not be found — it may have been removed.", "error");
          router.refresh();
          return;
        case "immutable":
          showToast("This quote can no longer be edited in its current state. Refresh and try again.", "error");
          router.refresh();
          return;
        default:
          showToast(GENERIC_ERROR, "error");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset className="space-y-3" aria-describedby={fieldErrors.target ? "target-error" : undefined}>
        <legend className="text-text-secondary block text-sm font-medium">
          Quote for<span className="text-danger ml-0.5" aria-hidden="true">*</span>
        </legend>
        <div className="flex gap-4">
          <label className="text-text-secondary flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="target-type"
              checked={targetType === "lead"}
              onChange={() => handleTargetTypeChange("lead")}
              className="focus-visible:ring-focus-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            />
            Lead
          </label>
          <label className="text-text-secondary flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="target-type"
              checked={targetType === "client"}
              onChange={() => handleTargetTypeChange("client")}
              className="focus-visible:ring-focus-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            />
            Client
          </label>
        </div>

        {targetType === "lead" && (
          <>
            {/* Real, associated label (not just aria-label) — sr-only
                since the radio group above already reads "Quote for: Lead"
                visually; also gives this control an accessible name that
                doesn't collide with the "Lead" radio's own name the way a
                bare aria-label="Lead" would (both would otherwise share
                the exact same accessible name). */}
            <label htmlFor="target-lead-select" className="sr-only">
              Select lead
            </label>
            <Select
              id="target-lead-select"
              value={leadId}
              onChange={(event) => {
                setLeadId(event.target.value);
                dismissErrors();
              }}
              required
              aria-invalid={!!fieldErrors.target}
            >
              <option value="" disabled>
                Select a lead
              </option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.label}
                </option>
              ))}
            </Select>
          </>
        )}
        {targetType === "client" && (
          <>
            <label htmlFor="target-client-select" className="sr-only">
              Select client
            </label>
            <Select
              id="target-client-select"
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                dismissErrors();
              }}
              required
              aria-invalid={!!fieldErrors.target}
            >
              <option value="" disabled>
                Select a client
              </option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </Select>
          </>
        )}
        {fieldErrors.target && (
          <p id="target-error" role="alert" className="text-danger text-sm">
            {fieldErrors.target}
          </p>
        )}
      </fieldset>

      <FormField label="Quote number" htmlFor="number" required error={fieldErrors.number}>
        <Input
          id="number"
          value={number}
          onChange={(event) => {
            setNumber(event.target.value);
            dismissErrors();
          }}
          required
          aria-invalid={!!fieldErrors.number}
          aria-describedby={fieldErrors.number ? "number-error" : undefined}
        />
      </FormField>

      <FormField label="Title" htmlFor="title" error={fieldErrors.title}>
        <Input
          id="title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            dismissErrors();
          }}
          aria-invalid={!!fieldErrors.title}
          aria-describedby={fieldErrors.title ? "title-error" : undefined}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Issue date" htmlFor="issueDate" required error={fieldErrors.issueDate}>
          <Input
            id="issueDate"
            type="date"
            value={issueDate}
            onChange={(event) => {
              setIssueDate(event.target.value);
              dismissErrors();
            }}
            required
            aria-invalid={!!fieldErrors.issueDate}
            aria-describedby={fieldErrors.issueDate ? "issueDate-error" : undefined}
          />
        </FormField>

        <FormField label="Valid until" htmlFor="validUntil" error={fieldErrors.validUntil}>
          <Input
            id="validUntil"
            type="date"
            value={validUntil}
            onChange={(event) => {
              setValidUntil(event.target.value);
              dismissErrors();
            }}
            aria-invalid={!!fieldErrors.validUntil}
            aria-describedby={fieldErrors.validUntil ? "validUntil-error" : undefined}
          />
        </FormField>
      </div>

      <FormField label="Currency" htmlFor="currency" required error={fieldErrors.currency}>
        <Select
          id="currency"
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value);
            dismissErrors();
          }}
          required
          aria-invalid={!!fieldErrors.currency}
          aria-describedby={fieldErrors.currency ? "currency-error" : undefined}
        >
          {currencyOptions.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
        {currencyFallbackNotice && <p className="text-warning mt-1 text-sm">{currencyFallbackNotice}</p>}
      </FormField>

      <div>
        <FormLabel htmlFor="items-list">Line items</FormLabel>
        {fieldErrors.items && (
          <p id="items-error" role="alert" className="text-danger mt-1 text-sm">
            {fieldErrors.items}
          </p>
        )}
        <div id="items-list" className="mt-2 space-y-3">
          {items.map((item, index) => (
            <InvoiceLineItemRow
              key={index}
              index={index}
              value={item}
              errors={itemErrors[index]}
              onChange={(next) => updateItem(index, next)}
              onRemove={() => removeItem(index)}
              onMoveUp={() => moveItem(index, -1)}
              onMoveDown={() => moveItem(index, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
            />
          ))}
        </div>
        <Button type="button" onClick={addItem} variant="secondary" className="mt-3">
          Add line
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Discount type" htmlFor="discountType" error={fieldErrors.discountType}>
          <Select
            id="discountType"
            value={discountType}
            onChange={(event) => {
              setDiscountType(event.target.value as "NONE" | "PERCENTAGE" | "FIXED");
              dismissErrors();
            }}
            aria-invalid={!!fieldErrors.discountType}
            aria-describedby={fieldErrors.discountType ? "discountType-error" : undefined}
          >
            {INVOICE_DISCOUNT_TYPES.map((option) => (
              <option key={option} value={option}>
                {option === "NONE" ? "No discount" : option === "PERCENTAGE" ? "Percentage" : "Fixed amount"}
              </option>
            ))}
          </Select>
        </FormField>

        {discountType !== "NONE" && (
          <FormField
            label={discountType === "PERCENTAGE" ? "Discount (%)" : "Discount amount"}
            htmlFor="discountValue"
            required
            error={fieldErrors.discountValue}
          >
            <Input
              id="discountValue"
              value={discountValue}
              onChange={(event) => {
                setDiscountValue(event.target.value);
                dismissErrors();
              }}
              required
              aria-invalid={!!fieldErrors.discountValue}
              aria-describedby={fieldErrors.discountValue ? "discountValue-error" : undefined}
            />
          </FormField>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Tax rate (%)" htmlFor="taxRatePercent" error={fieldErrors.taxRatePercent}>
          <Input
            id="taxRatePercent"
            value={taxRatePercent}
            onChange={(event) => {
              setTaxRatePercent(event.target.value);
              dismissErrors();
            }}
            aria-invalid={!!fieldErrors.taxRatePercent}
            aria-describedby={fieldErrors.taxRatePercent ? "taxRatePercent-error" : undefined}
          />
        </FormField>

        <FormField label="Tax label" htmlFor="taxLabel" error={fieldErrors.taxLabel}>
          <Select
            id="taxLabel"
            value={taxLabel}
            onChange={(event) => {
              setTaxLabel(event.target.value as "TAX" | "VAT" | "GST");
              dismissErrors();
            }}
            aria-invalid={!!fieldErrors.taxLabel}
            aria-describedby={fieldErrors.taxLabel ? "taxLabel-error" : undefined}
          >
            {INVOICE_TAX_LABELS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div aria-live="polite" className="border-border-default bg-surface-muted rounded-md border px-4 py-3 text-sm">
        {previewText ? (
          <span className="text-text-primary font-medium">Total: {previewText}</span>
        ) : (
          <span className="text-text-muted">Enter valid line items to see a total preview.</span>
        )}
        <p className="text-text-muted mt-1 text-xs">
          This is a live preview only — the saved total is always recalculated on the server.
        </p>
      </div>

      <FormField label="Notes" htmlFor="notes" error={fieldErrors.notes}>
        <Textarea
          id="notes"
          rows={3}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            dismissErrors();
          }}
          aria-invalid={!!fieldErrors.notes}
          aria-describedby={fieldErrors.notes ? "notes-error" : undefined}
        />
      </FormField>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
