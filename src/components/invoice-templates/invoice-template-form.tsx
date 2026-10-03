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
import { isStaleServerActionError, STALE_ACTION_MESSAGE } from "@/lib/action-error";
import { INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS } from "@/lib/validation/invoice";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import type { InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import type { InvoiceTemplateFieldErrors, InvoiceTemplateItemErrors, InvoiceTemplateWritableInput } from "@/lib/invoice-templates/validation";
import type { CreateInvoiceTemplateResult, UpdateInvoiceTemplateResult } from "@/lib/invoice-templates/service";

const GENERIC_ERROR = "Something went wrong. Please try again.";

const BLANK_LINE_ITEM: InvoiceLineItemFormValue = { description: "", quantity: "", unitPrice: "" };

export type InvoiceTemplateFormDefaults = {
  name?: string;
  notes?: string;
  internalNotes?: string;
  currency?: string;
  /** A plain digit string for the input — blank means "no default due date". `"0"` is valid and means "due on receipt" (see validation.ts's own [0, 3650] bound — unlike Quote Templates' validityDays, 0 is allowed here). */
  dueDateOffsetDays?: string;
  discountType?: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue?: string;
  taxRatePercent?: string;
  taxLabel?: "TAX" | "VAT" | "GST";
  items?: InvoiceLineItemFormValue[];
};

/**
 * Invoice Templates V1 — the single Create/Edit Invoice Template form.
 * Built the same way QuoteTemplateForm itself is (that component's own
 * header comment) rather than useActionState/FormData: `action` already
 * takes a plain, already-typed InvoiceTemplateWritableInput object, so
 * this component calls it directly inside startTransition and manages
 * fieldErrors/itemErrors as local state.
 *
 * Reuses InvoiceLineItemRow and calculateInvoiceTotals — the exact same
 * pure function Invoice Template creation/update itself validates
 * against server-side (see service.ts's own header comment) — for a live
 * total preview, never a second calculation implementation.
 *
 * No client/project, invoice number, issueDate, or absolute dueDate —
 * none of those exist on InvoiceTemplate (Product Owner decision — see
 * InvoiceTemplate's own schema comment). `dueDateOffsetDays` is the one
 * Template-only field: a relative day-count, not a date. `internalNotes`
 * is the one field QuoteTemplateForm has no equivalent for — staff-only,
 * copied verbatim into a created Invoice's own internalNotes, never
 * shown to the invoice's recipient (same framing RecurringInvoice's own
 * internalNotes field already uses).
 */
export function InvoiceTemplateForm({
  action,
  currencyOptions,
  defaultValues,
  submitLabel = "Save template",
  pendingLabel = "Saving…",
  successToast,
}: {
  action: (input: InvoiceTemplateWritableInput) => Promise<CreateInvoiceTemplateResult | UpdateInvoiceTemplateResult>;
  currencyOptions: readonly string[];
  defaultValues?: InvoiceTemplateFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
  successToast: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [fieldErrors, setFieldErrors] = useState<InvoiceTemplateFieldErrors>({});
  const [itemErrors, setItemErrors] = useState<InvoiceTemplateItemErrors>({});

  const [name, setName] = useState(defaultValues?.name ?? "");
  const [currency, setCurrency] = useState(defaultValues?.currency ?? currencyOptions[0] ?? "USD");
  const [dueDateOffsetDays, setDueDateOffsetDays] = useState(defaultValues?.dueDateOffsetDays ?? "");
  const [notes, setNotes] = useState(defaultValues?.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(defaultValues?.internalNotes ?? "");
  const [discountType, setDiscountType] = useState<"NONE" | "PERCENTAGE" | "FIXED">(defaultValues?.discountType ?? "NONE");
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

  // Preview only — calculateInvoiceTotals is the exact same pure function
  // the server calls to validate; the server's own recomputed result is
  // always what actually gets persisted and is never trusted to match
  // this preview (see this component's own header comment).
  const preview = calculateInvoiceTotals({
    subtotalSource: { mode: "lineItems", lineItems: items },
    discount: discountType === "NONE" ? { type: "NONE" } : { type: discountType, value: discountValue },
    taxRatePercent: taxRatePercent === "" ? null : taxRatePercent,
  });
  const previewText = preview.ok ? formatInvoiceCurrencyAmount(preview.total, currency) : null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    dismissErrors();

    const input: InvoiceTemplateWritableInput = {
      name,
      notes: notes || undefined,
      internalNotes: internalNotes || undefined,
      currency,
      dueDateOffsetDays: dueDateOffsetDays || undefined,
      discountType,
      discountValue: discountType === "NONE" ? undefined : discountValue,
      taxRatePercent: taxRatePercent || undefined,
      taxLabel,
      items,
    };

    startTransition(async () => {
      try {
        const result = await action(input);
        if (result.ok) {
          router.push(withToast("/settings/invoice-templates", successToast));
          return;
        }
        switch (result.reason) {
          case "VALIDATION":
            setFieldErrors(result.fieldErrors);
            setItemErrors(result.itemErrors ?? {});
            return;
          case "FORBIDDEN":
            showToast("You don't have permission to do that.", "error");
            router.refresh();
            return;
          case "NOT_FOUND":
            showToast("This template could not be found — it may have been removed.", "error");
            router.push("/settings/invoice-templates");
            return;
          default:
            showToast(GENERIC_ERROR, "error");
        }
      } catch (err) {
        showToast(isStaleServerActionError(err) ? STALE_ACTION_MESSAGE : GENERIC_ERROR, "error");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField label="Template name" htmlFor="name" required error={fieldErrors.name}>
        <Input
          id="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            dismissErrors();
          }}
          required
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? "name-error" : undefined}
        />
      </FormField>
      <p className="text-text-muted -mt-4 text-xs">For your own reference only — never shown to the invoice&rsquo;s recipient.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </FormField>

        <FormField label="Due (days after issue)" htmlFor="dueDateOffsetDays" error={fieldErrors.dueDateOffsetDays}>
          <Input
            id="dueDateOffsetDays"
            inputMode="numeric"
            value={dueDateOffsetDays}
            onChange={(event) => {
              setDueDateOffsetDays(event.target.value);
              dismissErrors();
            }}
            placeholder="e.g. 30"
            aria-invalid={!!fieldErrors.dueDateOffsetDays}
            aria-describedby="dueDateOffsetDays-hint"
          />
          <p id="dueDateOffsetDays-hint" className="text-text-muted mt-1 text-xs">
            Leave blank for no default. When set, applying this template fills in a new invoice&rsquo;s due date
            this many days after its issue date (0 means due on receipt; 0–3650).
          </p>
        </FormField>
      </div>

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
          Preview only — nothing here is stored on the template. Totals are always recalculated on the invoice itself.
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

      <FormField label="Internal notes" htmlFor="internalNotes" error={fieldErrors.internalNotes}>
        <Textarea
          id="internalNotes"
          rows={3}
          value={internalNotes}
          onChange={(event) => {
            setInternalNotes(event.target.value);
            dismissErrors();
          }}
          aria-invalid={!!fieldErrors.internalNotes}
          aria-describedby={fieldErrors.internalNotes ? "internalNotes-error" : undefined}
        />
      </FormField>
      <p className="text-text-muted -mt-4 text-xs">
        Staff-only — never shown to the invoice&rsquo;s recipient. Copied as-is into every invoice created from this template.
      </p>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
