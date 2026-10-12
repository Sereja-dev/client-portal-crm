"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { ChevronDownIcon } from "@/components/ui/icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CurrencySelect } from "@/components/invoices/currency-select";
import { toClientOptions, toProjectOptions } from "./recurring-invoice-relation-options";
import { INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS } from "@/lib/validation/invoice";
import { RECURRENCE_FREQUENCIES, type RecurrenceFrequencyValue } from "@/lib/validation/recurring-invoice";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { composeInvoiceNumberCandidate } from "@/lib/recurring-invoices/numbering";
import { encodeInvoiceLineItemsFormValue, type InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import { InvoiceLineItemRow } from "@/components/invoices/invoice-line-item-row";
import { deepEqual } from "@/lib/forms/deep-equal";
import { useReportDirtyState } from "@/components/forms/use-report-dirty-state";
import type { RecurringInvoiceFormState } from "@/types";

const initialState: RecurringInvoiceFormState = { error: null };

const FREQUENCY_LABELS: Record<RecurrenceFrequencyValue, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

const BLANK_LINE_ITEM: InvoiceLineItemFormValue = { description: "", quantity: "", unitPrice: "" };

type RecurringInvoiceFormDefaults = {
  name?: string;
  clientId?: string;
  projectId?: string | null;
  frequency?: RecurrenceFrequencyValue;
  firstIssueDate?: string;
  invoiceNumberPrefix?: string;
  startingSequence?: number;
  dueDateOffsetDays?: number | null;
  currency?: string;
  lineItems?: InvoiceLineItemFormValue[];
  discountType?: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue?: string;
  taxRatePercent?: string;
  taxLabel?: "TAX" | "VAT" | "GST";
  notes?: string;
  internalNotes?: string;
};

/**
 * Forms Improvement Slice C1a — the normalized shape RecurringInvoiceForm's
 * own dirty-state comparison is built from, covering every Product-
 * editable/submitted field (never presentation state — Advanced-
 * disclosure open/closed, hasAdvancedError bookkeeping, and the native-
 * select DOM-reapply effect's own internals are all deliberately
 * excluded; see this component's own `isDirty` comment below). Mirrors
 * InvoiceForm's own identical pattern. `frequency`/`firstIssueDate`/
 * `startingSequence` are included unconditionally — in edit mode no
 * control can ever change them (they're simply not rendered), so they
 * stay constant and never contribute a false-positive on their own.
 */
export type RecurringInvoiceDirtySnapshot = {
  clientId: string;
  projectId: string;
  name: string;
  frequency: RecurrenceFrequencyValue;
  firstIssueDate: string;
  invoiceNumberPrefix: string;
  startingSequence: string;
  dueDateOffsetDays: string;
  currency: string;
  lineItems: InvoiceLineItemFormValue[];
  discountType: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue: string;
  taxRatePercent: string;
  taxLabel: "TAX" | "VAT" | "GST";
  notes: string;
  internalNotes: string;
};

export function buildRecurringInvoiceDirtySnapshot(values: {
  clientId: string;
  projectId: string;
  name: string;
  frequency: RecurrenceFrequencyValue;
  firstIssueDate: string;
  invoiceNumberPrefix: string;
  startingSequence: string;
  dueDateOffsetDays: string;
  currency: string;
  lineItems: InvoiceLineItemFormValue[];
  discountType: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue: string;
  taxRatePercent: string;
  taxLabel: "TAX" | "VAT" | "GST";
  notes: string;
  internalNotes: string;
}): RecurringInvoiceDirtySnapshot {
  return {
    clientId: values.clientId,
    projectId: values.projectId,
    name: values.name,
    frequency: values.frequency,
    firstIssueDate: values.firstIssueDate,
    invoiceNumberPrefix: values.invoiceNumberPrefix,
    startingSequence: values.startingSequence,
    dueDateOffsetDays: values.dueDateOffsetDays,
    currency: values.currency,
    lineItems: values.lineItems,
    discountType: values.discountType,
    // discountValue's own FormField isn't even rendered while
    // discountType is NONE — a leftover/stale string there is never
    // something the user could currently see or have just edited.
    discountValue: values.discountType === "NONE" ? "" : values.discountValue,
    taxRatePercent: values.taxRatePercent,
    taxLabel: values.taxLabel,
    notes: values.notes,
    internalNotes: values.internalNotes,
  };
}

/**
 * Recurring Invoices Phase 2A — the shared create/edit template form.
 * Deliberately NOT InvoiceForm reused/extended (see this component's own
 * module doc): no flat/itemized toggle (a schedule is always itemized,
 * ≥1 line item, matching RecurringInvoiceLineItem's own schema — there is
 * no flat-amount concept for a template), no invoiceNumber field (replaced
 * by invoiceNumberPrefix + a create-only startingSequence), and no
 * issueDate/dueDate fields (replaced by firstIssueDate, create-only, and
 * dueDateOffsetDays). InvoiceLineItemRow and the line-items-form.ts
 * encode/decode pair ARE reused directly and unchanged — both are already
 * fully generic (no Invoice-lifecycle coupling), and
 * RecurringInvoiceLineItem's own shape (description/quantity/unitPrice)
 * is byte-identical to InvoiceLineItemFormValue.
 *
 * mode="edit" never renders frequency/firstIssueDate/startingSequence —
 * updateRecurringInvoice's own domain contract never accepts them (see
 * that function's own header comment: the recurrence schedule and
 * anchorDay are set once, at creation, never touched by an edit). anchorDay
 * itself is NEVER an input anywhere in this form, in either mode — it is
 * always derived server-side from firstIssueDate via deriveAnchorDay().
 *
 * Forms Improvement Slice B1 — four always-visible sections (plain
 * <fieldset>/<legend> grouping, the same primitive company-profile-form.tsx's
 * own Business/Contact/Address/Tax/Branding sections already use — no new
 * design-system component) plus one progressive-disclosure "Advanced
 * options" block at the end, mirroring InvoiceForm's own identical
 * pattern. Currency deliberately stays OUTSIDE Advanced here (unlike
 * InvoiceForm, where it lives inside Advanced) — Currency governs every
 * amount on the page (line items, totals, discount), so hiding it behind
 * a disclosure the user might never open would hide a decision that
 * affects everything else they're entering.
 */
export function RecurringInvoiceForm({
  mode,
  action,
  clients,
  projects,
  currencyOptions,
  defaultValues,
  submitLabel = "Create schedule",
  pendingLabel = "Creating…",
}: {
  mode: "create" | "edit";
  action: (prevState: RecurringInvoiceFormState, formData: FormData) => Promise<RecurringInvoiceFormState>;
  clients: { id: string; name: string }[];
  /** Every Project in the org, each carrying its own clientId — filtered client-side to the selected Client, same pattern InvoiceForm/TimeEntryForm already use. */
  projects: { id: string; label: string; clientId: string }[];
  currencyOptions: readonly string[];
  defaultValues?: RecurringInvoiceFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const [dismissedState, setDismissedState] = useState<RecurringInvoiceFormState | null>(null);
  const errorsVisible = state !== dismissedState;
  const fieldErrors = errorsVisible ? (state.fieldErrors ?? {}) : {};

  function dismissCurrentErrors() {
    setDismissedState(state);
  }

  const [clientId, setClientId] = useState(defaultValues?.clientId ?? "");
  const [projectId, setProjectId] = useState(defaultValues?.projectId ?? "");
  const projectsForClient = projects.filter((project) => project.clientId === clientId);
  // Forms Improvement Slice A2.2 — pure mappings of the exact same
  // already-fetched clients/projectsForClient data onto SearchableSelect's
  // own flat option shape; see recurring-invoice-relation-options.ts's
  // own header comment for why these stay local to this form.
  const clientOptions = toClientOptions(clients);
  const projectOptions = toProjectOptions(projectsForClient);

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    // Same "only clear if it no longer belongs" convenience InvoiceForm's
    // own handleClientChange uses — domain validation (resolveRecurringInvoiceTarget)
    // remains authoritative regardless of what this local state does.
    if (projectId && !projects.some((project) => project.id === projectId && project.clientId === nextClientId)) {
      setProjectId("");
    }
    dismissCurrentErrors();
  }

  // Recurring Invoice validation-reset remediation — these six fields
  // were previously uncontrolled (`defaultValue` only). React 19's
  // `useActionState` triggers a native `form.reset()` on every action
  // settlement, success or rejection alike; an uncontrolled field's
  // `defaultValue` prop never changes to reflect what was just
  // submitted, so that native reset silently discarded whatever the
  // user had typed — even when the validation error was on a completely
  // unrelated field. Converting them to controlled `value`/`onChange`
  // state (the same pattern every other field in this form already
  // uses) fixes it: a failed submission no longer changes any of this
  // state, so the next render repaints each field with exactly what the
  // user had entered, regardless of native reset. Initial value is the
  // exact same source each field's own `defaultValue` already was — no
  // change to create defaults or edit-persisted values.
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [firstIssueDate, setFirstIssueDate] = useState(defaultValues?.firstIssueDate ?? "");
  const [dueDateOffsetDays, setDueDateOffsetDays] = useState(
    defaultValues?.dueDateOffsetDays == null ? "" : String(defaultValues.dueDateOffsetDays),
  );
  const [taxLabel, setTaxLabel] = useState<"TAX" | "VAT" | "GST">(defaultValues?.taxLabel ?? "TAX");
  const [notes, setNotes] = useState(defaultValues?.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(defaultValues?.internalNotes ?? "");

  const [frequency, setFrequency] = useState<RecurrenceFrequencyValue>(defaultValues?.frequency ?? "MONTHLY");
  const [invoiceNumberPrefix, setInvoiceNumberPrefix] = useState(defaultValues?.invoiceNumberPrefix ?? "");
  const [startingSequence, setStartingSequence] = useState(String(defaultValues?.startingSequence ?? 1));
  const [currency, setCurrency] = useState(defaultValues?.currency ?? currencyOptions[0] ?? "USD");
  const [discountType, setDiscountType] = useState<"NONE" | "PERCENTAGE" | "FIXED">(defaultValues?.discountType ?? "NONE");
  const [discountValue, setDiscountValue] = useState(defaultValues?.discountValue ?? "");
  const [taxRatePercent, setTaxRatePercent] = useState(defaultValues?.taxRatePercent ?? "");

  // Validation-reset remediation, continued — a native <select>'s own
  // controlled `value` is not reliably re-applied by React after an
  // OUT-OF-BAND native form.reset() (the same underlying quirk already
  // diagnosed in company-profile-form.tsx's own Currency/Time zone
  // fields, there for an uncontrolled field; here it's controlled, and
  // the field's own React state never changes on a failed submission,
  // so a key-based remount keyed on anything derived from `state`
  // doesn't help either — the native reset can still land after the
  // remount commits, since requestFormReset() is scheduled relative to
  // the action settling, not to any particular child's own re-render).
  // A plain `<input>`/`<textarea>` never has this problem (confirmed by
  // every other field in this form) — it's specific to native
  // `<select>` elements, of which this form has exactly three:
  // `frequency`, `discountType`, and `taxLabel`. Rather than one
  // field-specific imperative-DOM-write effect per `<select>` (three
  // near-identical copies), this single effect re-applies all three
  // after every settlement, from one small shared helper. Each call
  // safely no-ops when that particular `<select>` isn't currently
  // rendered — `frequency` only exists in `mode === "create"`.
  // `document.getElementById` still finds `discountType`/`taxLabel`
  // even while the Advanced <details> below is collapsed (a closed
  // native <details> never unmounts its content, only hides it), so
  // this effect works identically regardless of the disclosure's state.
  // Deliberately not reaching for a `ref` on the shared `Select`
  // primitive (it isn't `forwardRef`-wrapped, and widening that shared
  // component is outside this fix's own narrow, Recurring-Invoice-only
  // scope) — each field's `id` is already unique on this page.
  useEffect(() => {
    function applySelectValue(id: string, value: string) {
      const el = document.getElementById(id);
      if (el instanceof HTMLSelectElement && el.value !== value) {
        el.value = value;
      }
    }
    applySelectValue("frequency", frequency);
    applySelectValue("discountType", discountType);
    applySelectValue("taxLabel", taxLabel);
  }, [state, frequency, discountType, taxLabel]);

  // Forms Improvement Slice B1 — "Advanced options" disclosure (Discount/
  // Tax/Notes/Internal notes only — Currency deliberately stays outside
  // Advanced in this form; see this component's own module doc for why).
  // Opens automatically the first time it's relevant — any non-default
  // persisted discount/tax/notes/internal-notes value — and is otherwise
  // a normal user-controlled disclosure from there (onToggle below keeps
  // this state in sync with the native element, so a manual open/close
  // is never overridden by a later render). Deterministic from
  // `defaultValues` alone — never from anything browser-only — so the
  // initial server-rendered markup and the first client render agree
  // (no hydration mismatch).
  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      (defaultValues?.discountType ?? "NONE") !== "NONE" ||
      Boolean(defaultValues?.taxRatePercent) ||
      Boolean(defaultValues?.notes) ||
      Boolean(defaultValues?.internalNotes),
  );

  // Auto-reveal the disclosure if a fresh server-side error lands on one
  // of the fields it hides — an error must never be invisible. Adjusted
  // directly during render (React's own sanctioned alternative to an
  // effect for "derive state from the latest render's own inputs" —
  // https://react.dev/learn/you-might-not-need-an-effect), not inside a
  // useEffect: the guard (`&& !advancedOpen`) makes this a single,
  // self-limiting extra render pass rather than a loop, and this only
  // ever opens the disclosure — it never closes one the user opened or
  // left open themselves, since the condition simply stops matching once
  // advancedOpen is already true. Mirrors InvoiceForm's own identical
  // pattern exactly.
  const hasAdvancedError =
    errorsVisible &&
    Boolean(
      fieldErrors.discountType ||
        fieldErrors.discountValue ||
        fieldErrors.taxRatePercent ||
        fieldErrors.taxLabel ||
        fieldErrors.notes ||
        fieldErrors.internalNotes,
    );
  if (hasAdvancedError && !advancedOpen) {
    setAdvancedOpen(true);
  }

  const [lineItems, setLineItems] = useState<InvoiceLineItemFormValue[]>(
    defaultValues?.lineItems && defaultValues.lineItems.length > 0 ? defaultValues.lineItems : [BLANK_LINE_ITEM],
  );
  function updateLineItem(index: number, next: InvoiceLineItemFormValue) {
    setLineItems((items) => items.map((item, i) => (i === index ? next : item)));
    dismissCurrentErrors();
  }
  function addLineItem() {
    setLineItems((items) => [...items, { ...BLANK_LINE_ITEM }]);
    dismissCurrentErrors();
  }
  function removeLineItem(index: number) {
    setLineItems((items) => (items.length > 1 ? items.filter((_, i) => i !== index) : items));
    dismissCurrentErrors();
  }
  function moveLineItem(index: number, direction: -1 | 1) {
    setLineItems((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    dismissCurrentErrors();
  }

  const preview = calculateInvoiceTotals({
    subtotalSource: { mode: "lineItems", lineItems },
    discount: discountType === "NONE" ? { type: "NONE" } : { type: discountType, value: discountValue },
    taxRatePercent: taxRatePercent === "" ? null : taxRatePercent,
  });
  const previewText = preview.ok ? formatInvoiceCurrencyAmount(preview.total, currency) : null;

  // "Next invoice" preview — never exposes candidate/attempt/collision
  // language, just the plain composed number a staff member would
  // otherwise have to work out themselves. In create mode this is the
  // starting sequence the user is currently typing; in edit mode
  // nextSequence is fixed (generation-engine-owned, not editable here),
  // so the preview sequence never changes as the user edits other fields.
  const previewSequenceNumber = mode === "create" ? Number(startingSequence) : (defaultValues?.startingSequence ?? 1);
  const numberPreview =
    invoiceNumberPrefix.trim().length > 0 && Number.isInteger(previewSequenceNumber) && previewSequenceNumber > 0
      ? composeInvoiceNumberCandidate(invoiceNumberPrefix.trim(), previewSequenceNumber)
      : null;

  // Forms Improvement Slice C1a — semantic dirty detection, mirroring
  // InvoiceForm's own identical approach. Captured once at mount as the
  // baseline (useState's own lazy initializer); compared every render
  // against the same snapshot shape built from current state. Must never
  // compete with or duplicate the validation-reset remediation's own
  // native-select post-settlement reapply effect above — this reads the
  // same React state that effect already keeps correct, nothing more.
  const currentDirtySnapshot = buildRecurringInvoiceDirtySnapshot({
    clientId,
    projectId,
    name,
    frequency,
    firstIssueDate,
    invoiceNumberPrefix,
    startingSequence,
    dueDateOffsetDays,
    currency,
    lineItems,
    discountType,
    discountValue,
    taxRatePercent,
    taxLabel,
    notes,
    internalNotes,
  });
  const [initialDirtySnapshot] = useState(() => currentDirtySnapshot);
  const isDirty = !deepEqual(currentDirtySnapshot, initialDirtySnapshot);
  useReportDirtyState(isDirty);

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="lineItems" value={encodeInvoiceLineItemsFormValue(lineItems)} readOnly />

      <fieldset className="space-y-4">
        <legend className="text-text-primary text-base font-semibold">Schedule</legend>

        <FormField label="Name" htmlFor="name" error={fieldErrors.name}>
          <Input
            id="name"
            name="name"
            value={name}
            placeholder="e.g. Monthly retainer — Acme Co"
            onChange={(event) => {
              setName(event.target.value);
              dismissCurrentErrors();
            }}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
          />
        </FormField>

        <FormField label="Client" htmlFor="clientId" required error={fieldErrors.clientId}>
          <SearchableSelect
            id="clientId"
            name="clientId"
            value={clientId}
            onChange={handleClientChange}
            options={clientOptions}
            required
            placeholder="Search clients…"
            emptyMessage="No matching clients"
            aria-invalid={!!fieldErrors.clientId}
            aria-describedby={fieldErrors.clientId ? "clientId-error" : undefined}
          />
        </FormField>

        <FormField label="Project" htmlFor="projectId" error={fieldErrors.projectId}>
          <SearchableSelect
            id="projectId"
            name="projectId"
            value={projectId}
            onChange={(next) => {
              setProjectId(next);
              dismissCurrentErrors();
            }}
            options={projectOptions}
            disabled={!clientId}
            placeholder="Search projects…"
            emptyMessage="No matching projects"
            aria-invalid={!!fieldErrors.projectId}
            aria-describedby={fieldErrors.projectId ? "projectId-error" : undefined}
          />
        </FormField>

        {mode === "create" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Frequency" htmlFor="frequency" required error={fieldErrors.frequency}>
              <Select
                id="frequency"
                name="frequency"
                value={frequency}
                onChange={(event) => {
                  setFrequency(event.target.value as RecurrenceFrequencyValue);
                  dismissCurrentErrors();
                }}
                required
                aria-invalid={!!fieldErrors.frequency}
                aria-describedby={fieldErrors.frequency ? "frequency-error" : undefined}
              >
                {RECURRENCE_FREQUENCIES.map((value) => (
                  <option key={value} value={value}>
                    {FREQUENCY_LABELS[value]}
                  </option>
                ))}
              </Select>
              {frequency !== "WEEKLY" && (
                <p className="text-text-muted mt-1 text-xs">
                  Month-end schedules automatically use the last valid day in shorter months.
                </p>
              )}
            </FormField>

            <FormField label="First issue date" htmlFor="firstIssueDate" required error={fieldErrors.firstIssueDate}>
              <Input
                id="firstIssueDate"
                name="firstIssueDate"
                type="date"
                value={firstIssueDate}
                required
                onChange={(event) => {
                  setFirstIssueDate(event.target.value);
                  dismissCurrentErrors();
                }}
                aria-invalid={!!fieldErrors.firstIssueDate}
                aria-describedby={fieldErrors.firstIssueDate ? "firstIssueDate-error" : undefined}
              />
            </FormField>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-text-primary text-base font-semibold">Invoice numbering &amp; due date</legend>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Invoice number prefix" htmlFor="invoiceNumberPrefix" required error={fieldErrors.invoiceNumberPrefix}>
            <Input
              id="invoiceNumberPrefix"
              name="invoiceNumberPrefix"
              value={invoiceNumberPrefix}
              onChange={(event) => {
                setInvoiceNumberPrefix(event.target.value);
                dismissCurrentErrors();
              }}
              placeholder="INV-"
              required
              aria-invalid={!!fieldErrors.invoiceNumberPrefix}
              aria-describedby={fieldErrors.invoiceNumberPrefix ? "invoiceNumberPrefix-error" : undefined}
            />
          </FormField>

          {mode === "create" && (
            <FormField label="Starting number" htmlFor="startingSequence" error={fieldErrors.startingSequence}>
              <Input
                id="startingSequence"
                name="startingSequence"
                type="number"
                min={1}
                step={1}
                value={startingSequence}
                onChange={(event) => {
                  setStartingSequence(event.target.value);
                  dismissCurrentErrors();
                }}
                aria-invalid={!!fieldErrors.startingSequence}
                aria-describedby={fieldErrors.startingSequence ? "startingSequence-error" : undefined}
              />
            </FormField>
          )}
        </div>

        <div aria-live="polite" className="border-border-default bg-surface-muted rounded-md border px-4 py-3 text-sm">
          {numberPreview ? (
            <span className="text-text-primary font-medium">Next invoice: {numberPreview}</span>
          ) : (
            <span className="text-text-muted">Enter a prefix to see the next invoice number.</span>
          )}
        </div>

        <FormField label="Due date offset (days)" htmlFor="dueDateOffsetDays" error={fieldErrors.dueDateOffsetDays}>
          <Input
            id="dueDateOffsetDays"
            name="dueDateOffsetDays"
            type="number"
            min={0}
            step={1}
            value={dueDateOffsetDays}
            onChange={(event) => {
              setDueDateOffsetDays(event.target.value);
              dismissCurrentErrors();
            }}
            aria-invalid={!!fieldErrors.dueDateOffsetDays}
            aria-describedby={fieldErrors.dueDateOffsetDays ? "dueDateOffsetDays-error" : undefined}
          />
          <p className="text-text-muted mt-1 text-xs">
            Each generated invoice&rsquo;s due date is this many days after its issue date. Leave blank for no due date.
          </p>
        </FormField>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-text-primary text-base font-semibold">Invoice contents</legend>

        <div>
          <FormLabel htmlFor="lineItems-list">Line items</FormLabel>
          {fieldErrors.lineItems && (
            <p id="lineItems-error" role="alert" className="text-danger mt-1 text-sm">
              {fieldErrors.lineItems}
            </p>
          )}
          <div id="lineItems-list" className="mt-2 space-y-3">
            {lineItems.map((item, index) => (
              <InvoiceLineItemRow
                key={index}
                index={index}
                value={item}
                onChange={(next) => updateLineItem(index, next)}
                onRemove={() => removeLineItem(index)}
                onMoveUp={() => moveLineItem(index, -1)}
                onMoveDown={() => moveLineItem(index, 1)}
                canMoveUp={index > 0}
                canMoveDown={index < lineItems.length - 1}
              />
            ))}
          </div>
          <Button type="button" onClick={addLineItem} variant="secondary" className="mt-3">
            Add line
          </Button>
        </div>

        <div aria-live="polite" className="border-border-default bg-surface-muted rounded-md border px-4 py-3 text-sm">
          {previewText ? (
            <span className="text-text-primary font-medium">Total per invoice: {previewText}</span>
          ) : (
            <span className="text-text-muted">Enter valid line items to see a total preview.</span>
          )}
        </div>

        <FormField label="Currency" htmlFor="currency" required error={fieldErrors.currency}>
          <CurrencySelect
            id="currency"
            name="currency"
            value={currency}
            onChange={(next) => {
              setCurrency(next);
              dismissCurrentErrors();
            }}
            supportedCurrencies={currencyOptions}
            required
            aria-invalid={!!fieldErrors.currency}
            aria-describedby={fieldErrors.currency ? "currency-error" : undefined}
          />
        </FormField>
      </fieldset>

      <details
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        className="group border-border-default rounded-md border"
      >
        <summary className="text-text-secondary flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          Advanced options (discount, tax, notes)
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>

        <div className="space-y-4 border-t px-4 py-4 border-border-default">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Discount type" htmlFor="discountType" error={fieldErrors.discountType}>
              <Select
                id="discountType"
                name="discountType"
                value={discountType}
                onChange={(event) => {
                  setDiscountType(event.target.value as "NONE" | "PERCENTAGE" | "FIXED");
                  dismissCurrentErrors();
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
                  name="discountValue"
                  value={discountValue}
                  onChange={(event) => {
                    setDiscountValue(event.target.value);
                    dismissCurrentErrors();
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
                name="taxRatePercent"
                value={taxRatePercent}
                onChange={(event) => {
                  setTaxRatePercent(event.target.value);
                  dismissCurrentErrors();
                }}
                aria-invalid={!!fieldErrors.taxRatePercent}
                aria-describedby={fieldErrors.taxRatePercent ? "taxRatePercent-error" : undefined}
              />
            </FormField>

            <FormField label="Tax label" htmlFor="taxLabel" error={fieldErrors.taxLabel}>
              {/*
                Native <select> — one of three fields covered by the
                consolidated post-settlement re-apply effect declared
                above (alongside `frequency` and `discountType`'s
                state). See that effect's own comment for why this is
                needed, and for why it still works correctly while this
                disclosure is collapsed.
              */}
              <Select
                id="taxLabel"
                name="taxLabel"
                value={taxLabel}
                onChange={(event) => {
                  setTaxLabel(event.target.value as "TAX" | "VAT" | "GST");
                  dismissCurrentErrors();
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

          <FormField label="Notes" htmlFor="notes" error={fieldErrors.notes}>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                dismissCurrentErrors();
              }}
              aria-invalid={!!fieldErrors.notes}
              aria-describedby={fieldErrors.notes ? "notes-error" : undefined}
            />
            <p className="text-text-muted mt-1 text-xs">Shown on every generated invoice.</p>
          </FormField>

          <FormField label="Internal notes" htmlFor="internalNotes" error={fieldErrors.internalNotes}>
            <Textarea
              id="internalNotes"
              name="internalNotes"
              rows={3}
              value={internalNotes}
              onChange={(event) => {
                setInternalNotes(event.target.value);
                dismissCurrentErrors();
              }}
              aria-invalid={!!fieldErrors.internalNotes}
              aria-describedby={fieldErrors.internalNotes ? "internalNotes-error" : undefined}
            />
            <p className="text-text-muted mt-1 text-xs">Staff-only — never shown to the client.</p>
          </FormField>
        </div>
      </details>

      {state.error && errorsVisible && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
