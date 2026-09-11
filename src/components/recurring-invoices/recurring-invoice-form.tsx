"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS } from "@/lib/validation/invoice";
import { RECURRENCE_FREQUENCIES, type RecurrenceFrequencyValue } from "@/lib/validation/recurring-invoice";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { composeInvoiceNumberCandidate } from "@/lib/recurring-invoices/numbering";
import { encodeInvoiceLineItemsFormValue, type InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import { InvoiceLineItemRow } from "@/components/invoices/invoice-line-item-row";
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

  const [frequency, setFrequency] = useState<RecurrenceFrequencyValue>(defaultValues?.frequency ?? "MONTHLY");
  const [invoiceNumberPrefix, setInvoiceNumberPrefix] = useState(defaultValues?.invoiceNumberPrefix ?? "");
  const [startingSequence, setStartingSequence] = useState(String(defaultValues?.startingSequence ?? 1));
  const [currency, setCurrency] = useState(defaultValues?.currency ?? currencyOptions[0] ?? "USD");
  const [discountType, setDiscountType] = useState<"NONE" | "PERCENTAGE" | "FIXED">(defaultValues?.discountType ?? "NONE");
  const [discountValue, setDiscountValue] = useState(defaultValues?.discountValue ?? "");
  const [taxRatePercent, setTaxRatePercent] = useState(defaultValues?.taxRatePercent ?? "");

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

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="lineItems" value={encodeInvoiceLineItemsFormValue(lineItems)} readOnly />

      <FormField label="Name" htmlFor="name" error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          defaultValue={defaultValues?.name ?? ""}
          placeholder="e.g. Monthly retainer — Acme Co"
          onChange={dismissCurrentErrors}
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? "name-error" : undefined}
        />
      </FormField>

      <FormField label="Client" htmlFor="clientId" required error={fieldErrors.clientId}>
        <Select
          id="clientId"
          name="clientId"
          value={clientId}
          onChange={(event) => handleClientChange(event.target.value)}
          required
          aria-invalid={!!fieldErrors.clientId}
          aria-describedby={fieldErrors.clientId ? "clientId-error" : undefined}
        >
          <option value="" disabled>
            Select a client
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Project" htmlFor="projectId" error={fieldErrors.projectId}>
        <Select
          id="projectId"
          name="projectId"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            dismissCurrentErrors();
          }}
          disabled={!clientId}
          aria-invalid={!!fieldErrors.projectId}
          aria-describedby={fieldErrors.projectId ? "projectId-error" : undefined}
        >
          <option value="">No project</option>
          {projectsForClient.map((project) => (
            <option key={project.id} value={project.id}>
              {project.label}
            </option>
          ))}
        </Select>
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
              defaultValue={defaultValues?.firstIssueDate}
              required
              onChange={dismissCurrentErrors}
              aria-invalid={!!fieldErrors.firstIssueDate}
              aria-describedby={fieldErrors.firstIssueDate ? "firstIssueDate-error" : undefined}
            />
          </FormField>
        </div>
      )}

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
          defaultValue={defaultValues?.dueDateOffsetDays ?? ""}
          onChange={dismissCurrentErrors}
          aria-invalid={!!fieldErrors.dueDateOffsetDays}
          aria-describedby={fieldErrors.dueDateOffsetDays ? "dueDateOffsetDays-error" : undefined}
        />
        <p className="text-text-muted mt-1 text-xs">
          Each generated invoice&rsquo;s due date is this many days after its issue date. Leave blank for no due date.
        </p>
      </FormField>

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
        <Select
          id="currency"
          name="currency"
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value);
            dismissCurrentErrors();
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
          <Select
            id="taxLabel"
            name="taxLabel"
            defaultValue={defaultValues?.taxLabel ?? "TAX"}
            onChange={dismissCurrentErrors}
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
          defaultValue={defaultValues?.notes ?? ""}
          onChange={dismissCurrentErrors}
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
          defaultValue={defaultValues?.internalNotes ?? ""}
          onChange={dismissCurrentErrors}
          aria-invalid={!!fieldErrors.internalNotes}
          aria-describedby={fieldErrors.internalNotes ? "internalNotes-error" : undefined}
        />
        <p className="text-text-muted mt-1 text-xs">Staff-only — never shown to the client.</p>
      </FormField>

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
