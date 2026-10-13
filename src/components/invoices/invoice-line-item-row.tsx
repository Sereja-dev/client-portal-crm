"use client";

import { FormLabel } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import type { InvoiceLineItemFieldKey } from "@/types";

function RowField({
  id,
  label,
  value,
  error,
  onChange,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-danger mt-1 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

export function InvoiceLineItemRow({
  index,
  value,
  errors,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  value: InvoiceLineItemFormValue;
  errors?: Partial<Record<InvoiceLineItemFieldKey, string>>;
  onChange: (next: InvoiceLineItemFormValue) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    // Desktop line-item compression fix — below this point, the bare
    // `1fr` Description track had no protective minimum: at any
    // container width where Qty (7rem) + Unit price (8rem) + the
    // action-button cluster (auto, content-sized) already claim their
    // full space, the `1fr` track absorbed 100% of the remaining
    // shortfall, silently collapsing Description to ~73–75px with no
    // overflow of any kind to signal it (confirmed on Recurring Invoice
    // at every desktop width, and dormant in Invoice/Quote's own
    // >=1024px two-column layout — see the dedicated overflow-readiness
    // audit). `minmax(10rem, 1fr)` gives Description a real floor
    // instead; `overflow-x-auto` on this same element (the narrowest box
    // that actually owns the grid — no new wrapper needed) is the
    // fallback for the rare width where even Qty/Unit price/actions at
    // their full fixed sizes plus a 10rem Description genuinely can't
    // fit: the row scrolls locally, the page itself never does. Below
    // `sm:`, `grid-cols-1` is unaffected — the stacked mobile layout
    // never needs the scroll affordance, since a single column never
    // exceeds its own container.
    //
    // `min-w-0` is required alongside `overflow-x-auto`, not optional —
    // every browser's own UA stylesheet gives `<fieldset>` a default
    // `min-width: min-content`, which (confirmed empirically while
    // building this fix) overrides `overflow-x-auto` entirely: without
    // it, the fieldset refuses to shrink below its own tracks' combined
    // minimum and instead grows past its assigned width, pushing the
    // overflow onto its parent and ultimately the page — exactly the
    // page-level overflow this fix must never reintroduce.
    <fieldset
      aria-label={`Line item ${index + 1}`}
      className="border-border-default grid min-w-0 grid-cols-1 gap-3 overflow-x-auto rounded-md border p-3 sm:grid-cols-[minmax(10rem,1fr)_7rem_8rem_auto]"
    >
      <RowField
        id={`lineItems.${index}.description`}
        label="Description"
        value={value.description}
        error={errors?.description}
        onChange={(next) => onChange({ ...value, description: next })}
      />
      <RowField
        id={`lineItems.${index}.quantity`}
        label="Qty"
        value={value.quantity}
        error={errors?.quantity}
        onChange={(next) => onChange({ ...value, quantity: next })}
      />
      <RowField
        id={`lineItems.${index}.unitPrice`}
        label="Unit price"
        value={value.unitPrice}
        error={errors?.unitPrice}
        onChange={(next) => onChange({ ...value, unitPrice: next })}
      />
      <div className="flex items-end gap-1 pb-0.5">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label={`Move line item ${index + 1} up`}
          className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-2 py-2 text-sm transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label={`Move line item ${index + 1} down`}
          className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-2 py-2 text-sm transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove line item ${index + 1}`}
          className="border-border-strong text-danger focus-visible:ring-danger rounded-md border px-2 py-2 text-sm transition-colors hover:bg-danger-subtle focus:outline-none focus-visible:ring-2"
        >
          Remove
        </button>
      </div>
    </fieldset>
  );
}
