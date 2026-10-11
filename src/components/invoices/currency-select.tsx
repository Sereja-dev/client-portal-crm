"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { buildOrderedCurrencyOptions } from "@/lib/invoices/currency-select-options";

/**
 * Forms Improvement Slice A1 — the thin currency-specific wrapper around
 * the generic SearchableSelect primitive (§15 of the slice brief: the
 * generic primitive knows only options/selected value/search/
 * accessibility/selection; this layer is the one place that knows
 * "currency" at all — popular-group ordering, never financial
 * calculation, FX, or any Server Action/validation logic).
 *
 * Lives under `components/invoices/` rather than a currency-neutral `ui/`
 * location, matching this codebase's own already-established precedent
 * for a currency/invoice-domain component reused unmodified by Quote and
 * Recurring Invoice (see InvoiceLineItemRow, imported directly by
 * quote-form.tsx and recurring-invoice-form.tsx today) — Company
 * Settings imports it the same way.
 *
 * `supportedCurrencies` is intentionally just `readonly string[]`, not a
 * fixed import of one specific currency source — Invoice/Recurring
 * Invoice/Quote already pass `getSupportedInvoiceCurrencies()` (the
 * narrower two-decimal-only set) while Company Settings already passes
 * the broader `getSupportedCurrencies()` (full `Intl.supportedValuesOf
 * ("currency")`); this component must never narrow or merge those two
 * pre-existing, independently-correct sources — doing so would silently
 * change what each surface currently accepts.
 */
export function CurrencySelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  supportedCurrencies,
  disabled,
  required,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  supportedCurrencies: readonly string[];
  disabled?: boolean;
  required?: boolean;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
}) {
  const options = buildOrderedCurrencyOptions(supportedCurrencies);

  return (
    <SearchableSelect
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      options={options}
      disabled={disabled}
      required={required}
      placeholder="Search currencies…"
      emptyMessage="No matching currencies"
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}
