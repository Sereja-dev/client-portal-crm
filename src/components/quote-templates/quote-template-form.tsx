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
import { calculateQuoteTotals } from "@/lib/quotes/calculations";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import type { InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import type { QuoteTemplateFieldErrors, QuoteTemplateItemErrors, QuoteTemplateWritableInput } from "@/lib/quote-templates/validation";
import type { CreateQuoteTemplateResult, UpdateQuoteTemplateResult } from "@/lib/quote-templates/service";

const GENERIC_ERROR = "Something went wrong. Please try again.";

const BLANK_LINE_ITEM: InvoiceLineItemFormValue = { description: "", quantity: "", unitPrice: "" };

export type QuoteTemplateFormDefaults = {
  name?: string;
  title?: string;
  notes?: string;
  currency?: string;
  /** A plain digit string for the input — blank means "no default validity" (never "0", see validation.ts's own [1, 3650] bound). */
  validityDays?: string;
  discountType?: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue?: string;
  taxRatePercent?: string;
  taxLabel?: "TAX" | "VAT" | "GST";
  items?: InvoiceLineItemFormValue[];
};

/**
 * Quote Templates Phase 2 (Section C/D/G/H) — the single Create/Edit
 * Quote Template form. Deliberately built the same way QuoteForm itself
 * is (src/components/quotes/quote-form.tsx's own header comment) rather
 * than useActionState/FormData: `action` already takes a plain,
 * already-typed QuoteTemplateWritableInput object (mirroring
 * createQuoteAction/updateQuoteAction's own exact shape), so this
 * component calls it directly inside startTransition and manages
 * fieldErrors/itemErrors as local state.
 *
 * Reuses InvoiceLineItemRow (the exact same generic, Invoice-agnostic
 * {description, quantity, unitPrice} row QuoteForm itself already
 * reuses — see that component's own header comment for why this is safe)
 * and calculateQuoteTotals (the exact same pure function Quote Template
 * creation/update itself validates against server-side — see
 * service.ts's own header comment) for a live total preview, never a
 * second calculation implementation. Discount/tax UI is a byte-for-byte
 * structural copy of QuoteForm's own equivalent blocks (Section I) —
 * same options, same conditional-required behavior, same error wiring —
 * so a Quote Template can never offer an option ordinary Quote creation
 * doesn't.
 *
 * No target (Lead/Client), number, issueDate, or absolute validUntil —
 * none of those exist on QuoteTemplate (Section D/E). `validityDays` is
 * the one Template-only field: a relative day-count, not a date (Section
 * F) — never an absolute date picker.
 */
export function QuoteTemplateForm({
  action,
  currencyOptions,
  defaultValues,
  submitLabel = "Save template",
  pendingLabel = "Saving…",
  successToast,
}: {
  action: (input: QuoteTemplateWritableInput) => Promise<CreateQuoteTemplateResult | UpdateQuoteTemplateResult>;
  currencyOptions: readonly string[];
  defaultValues?: QuoteTemplateFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
  successToast: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [fieldErrors, setFieldErrors] = useState<QuoteTemplateFieldErrors>({});
  const [itemErrors, setItemErrors] = useState<QuoteTemplateItemErrors>({});

  const [name, setName] = useState(defaultValues?.name ?? "");
  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [currency, setCurrency] = useState(defaultValues?.currency ?? currencyOptions[0] ?? "USD");
  const [validityDays, setValidityDays] = useState(defaultValues?.validityDays ?? "");
  const [notes, setNotes] = useState(defaultValues?.notes ?? "");
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

  // Preview only — calculateQuoteTotals is the exact same pure function
  // the server calls to validate; the server's own recomputed result is
  // always what actually gets persisted and is never trusted to match
  // this preview (see this component's own header comment).
  const preview = calculateQuoteTotals({
    subtotalSource: { mode: "lineItems", lineItems: items },
    discount: discountType === "NONE" ? { type: "NONE" } : { type: discountType, value: discountValue },
    taxRatePercent: taxRatePercent === "" ? null : taxRatePercent,
  });
  const previewText = preview.ok ? formatInvoiceCurrencyAmount(preview.total, currency) : null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    dismissErrors();

    const input: QuoteTemplateWritableInput = {
      name,
      title: title || undefined,
      notes: notes || undefined,
      currency,
      validityDays: validityDays || undefined,
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
          router.push(withToast("/settings/templates", successToast));
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
            router.push("/settings/templates");
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
      <p className="text-text-muted -mt-4 text-xs">For your own reference only — never shown to the quote&rsquo;s recipient.</p>

      <FormField label="Quote title" htmlFor="title" error={fieldErrors.title}>
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

        <FormField label="Valid for (days)" htmlFor="validityDays" error={fieldErrors.validityDays}>
          <Input
            id="validityDays"
            inputMode="numeric"
            value={validityDays}
            onChange={(event) => {
              setValidityDays(event.target.value);
              dismissErrors();
            }}
            placeholder="e.g. 30"
            aria-invalid={!!fieldErrors.validityDays}
            aria-describedby="validityDays-hint"
          />
          <p id="validityDays-hint" className="text-text-muted mt-1 text-xs">
            Leave blank for no default. When set, applying this template fills in a new quote&rsquo;s valid-until date
            this many days after its issue date (1–3650).
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
          Preview only — nothing here is stored on the template. Totals are always recalculated on the quote itself.
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
