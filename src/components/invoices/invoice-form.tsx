"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { ChevronDownIcon } from "@/components/ui/icons";
import { CurrencySelect } from "@/components/invoices/currency-select";
import { INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS } from "@/lib/validation/invoice";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { buildInvoicePreviewTotals } from "@/lib/invoices/invoice-preview-view-model";
import { parseDateOnly, formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { encodeInvoiceLineItemsFormValue, type InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import { InvoiceLineItemRow } from "./invoice-line-item-row";
import { InvoicePreview } from "./invoice-preview";
import type { InvoiceFormState } from "@/types";

const initialState: InvoiceFormState = { error: null };

export type InvoiceFormDefaults = {
  invoiceNumber?: string;
  clientId?: string;
  projectId?: string | null;
  mode?: "flat" | "itemized";
  amount?: string;
  lineItems?: InvoiceLineItemFormValue[];
  currency?: string;
  issueDate?: string;
  dueDate?: string;
  notes?: string;
  internalNotes?: string;
  discountType?: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue?: string;
  taxRatePercent?: string;
  taxLabel?: "TAX" | "VAT" | "GST";
};

const BLANK_LINE_ITEM: InvoiceLineItemFormValue = { description: "", quantity: "", unitPrice: "" };

/**
 * Invoice System Slice 2b — the DRAFT create/edit form (real production
 * Client Component; this permanently exercises Slice 2a's browser-safe
 * calculateInvoiceTotals()/formatInvoiceCurrencyAmount() imports on every
 * `npm run build`, docs/invoicing-architecture.md §5).
 *
 * Every field that participates in either preview (the inline numeric
 * total below, or the Invoice Live Preview V1 document panel added
 * alongside the form) is controlled local state, held as canonical
 * strings — never JS arithmetic for money, only handed to
 * calculateInvoiceTotals() (directly, or via buildInvoicePreviewTotals(),
 * which calls it internally and nothing else — see that module's own
 * header comment). The server independently recomputes everything on
 * submit and never trusts either preview.
 *
 * Invoice Live Preview V1 — visual hierarchy simplification: Invoice
 * number/Client/Project/Invoice type/Amount-or-line-items/Issue+Due dates
 * stay always-visible (the primary workflow); Currency/Discount/Tax/Notes/
 * Internal notes move into a single native <details> "Advanced options"
 * disclosure (the same disclosure idiom Sidebar's own nav groups already
 * use — no new design system component). A native <details> only hides
 * its children visually when closed; every field inside it still submits
 * its value with the form exactly as before, so collapsing it changes no
 * validation or persistence behavior. The disclosure opens automatically
 * the first time it's relevant (a non-default currency/discount/tax
 * default value, or a fresh server-side error on one of its own fields)
 * and is otherwise fully user-controlled from then on.
 */
export function InvoiceForm({
  action,
  clients,
  projects,
  currencyOptions,
  currencyFallbackNotice,
  defaultValues,
  companyDisplayName,
  submitLabel = "Create invoice",
  pendingLabel = "Creating…",
  onDirtyChange,
}: {
  action: (prevState: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  clients: { id: string; name: string }[];
  /** Every Project in the org, each carrying its own clientId — filtered client-side to the selected Client (Quotes / Estimates Phase 2.3). */
  projects: { id: string; label: string; clientId: string }[];
  currencyOptions: readonly string[];
  currencyFallbackNotice?: string;
  defaultValues?: InvoiceFormDefaults;
  /**
   * Invoice Live Preview V1 — the company profile's own display name
   * (Organization.name, the same field getCompanyProfile() already
   * returns), shown as the preview's "From" identity. Optional, with a
   * generic "Your company" placeholder when omitted, so every existing
   * caller of this component (including direct-render unit tests that
   * construct InvoiceForm without this prop) keeps working unchanged.
   */
  companyDisplayName?: string;
  submitLabel?: string;
  pendingLabel?: string;
  /**
   * Invoice System Official Slice 3, sub-PR 3b — fires the first time (and
   * every time) the user changes anything, via this component's own
   * existing centralized error-dismissal path below — every editable
   * field already routes through dismissCurrentErrors() on change, so
   * this needed no new per-field wiring. Never fires on initial mount.
   * Optional so every other current caller of InvoiceForm (the plain
   * create page, the duplicate page) is unaffected.
   */
  onDirtyChange?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // Stale-error dismissal (docs/invoicing-architecture.md corrected design):
  // errors are visible only when the CURRENT action-state object has not
  // been locally dismissed. A fresh action result is always a NEW object
  // identity, so submitting again automatically un-dismisses.
  const [dismissedState, setDismissedState] = useState<InvoiceFormState | null>(null);
  const errorsVisible = state !== dismissedState;
  const fieldErrors = errorsVisible ? (state.fieldErrors ?? {}) : {};
  const lineItemErrors = errorsVisible ? (state.lineItemErrors ?? {}) : {};

  function dismissCurrentErrors() {
    setDismissedState(state);
    onDirtyChange?.();
  }

  // Quotes / Estimates Phase 2.3 — Client REQUIRED, Project OPTIONAL and
  // filtered to whichever Client is currently selected. Changing Client
  // clears an incompatible Project selection (never silently carries a
  // Project belonging to the OLD Client forward) — the server
  // independently re-verifies this same pairing regardless (see
  // resolveInvoiceTarget), this is purely a UX convenience.
  const [clientId, setClientId] = useState(defaultValues?.clientId ?? "");
  const [projectId, setProjectId] = useState(defaultValues?.projectId ?? "");
  const projectsForClient = projects.filter((project) => project.clientId === clientId);

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    // Only clear the Project if it no longer belongs to the newly chosen
    // Client — switching back and forth between two Clients that both
    // happen to include the same-named Project id never surprises the
    // user by clearing a still-valid selection.
    if (projectId && !projects.some((project) => project.id === projectId && project.clientId === nextClientId)) {
      setProjectId("");
    }
    dismissCurrentErrors();
  }

  const [invoiceNumber, setInvoiceNumber] = useState(defaultValues?.invoiceNumber ?? "");
  const [mode, setMode] = useState<"flat" | "itemized">(defaultValues?.mode ?? "flat");
  const [amount, setAmount] = useState(defaultValues?.amount ?? "");
  const [lineItems, setLineItems] = useState<InvoiceLineItemFormValue[]>(
    defaultValues?.lineItems && defaultValues.lineItems.length > 0 ? defaultValues.lineItems : [BLANK_LINE_ITEM],
  );
  const [currency, setCurrency] = useState(defaultValues?.currency ?? currencyOptions[0] ?? "USD");
  const [issueDate, setIssueDate] = useState(defaultValues?.issueDate ?? "");
  const [dueDate, setDueDate] = useState(defaultValues?.dueDate ?? "");
  const [discountType, setDiscountType] = useState<"NONE" | "PERCENTAGE" | "FIXED">(defaultValues?.discountType ?? "NONE");
  const [discountValue, setDiscountValue] = useState(defaultValues?.discountValue ?? "");
  const [taxRatePercent, setTaxRatePercent] = useState(defaultValues?.taxRatePercent ?? "");
  const [taxLabel, setTaxLabel] = useState<"TAX" | "VAT" | "GST">(defaultValues?.taxLabel ?? "TAX");
  const [notes, setNotes] = useState(defaultValues?.notes ?? "");

  // Invoice Live Preview V1 — "Advanced options" disclosure (Currency/
  // Discount/Tax/Notes/Internal notes). Opens automatically the first
  // time it's relevant — a non-default starting currency/discount/tax
  // (e.g. a duplicated or edited Invoice that already carries one), or a
  // currency-fallback notice — and otherwise starts closed, matching the
  // "secondary/advanced" grouping. From there it is a normal user-
  // controlled disclosure (onToggle below keeps this state in sync with
  // the native element, so a manual open/close is never overridden by a
  // later render).
  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      Boolean(currencyFallbackNotice) ||
      (defaultValues?.discountType ?? "NONE") !== "NONE" ||
      Boolean(defaultValues?.taxRatePercent),
  );

  // Auto-reveal the disclosure if a fresh server-side error lands on one
  // of the fields it hides — an error must never be invisible. Adjusted
  // directly during render (React's own sanctioned alternative to an
  // effect for "derive state from the latest render's own inputs" —
  // https://react.dev/learn/you-might-not-need-an-effect), not inside a
  // useEffect: the guard (`&& !advancedOpen`) makes this a single,
  // self-limiting extra render pass rather than a loop, and this only
  // ever opens the disclosure — it never closes one the user opened or
  // left open themselves, since the condition simply stops matching
  // once advancedOpen is already true.
  const hasAdvancedError =
    errorsVisible &&
    Boolean(
      fieldErrors.currency ||
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
    subtotalSource: mode === "flat" ? { mode: "flat", amount } : { mode: "lineItems", lineItems },
    discount: discountType === "NONE" ? { type: "NONE" } : { type: discountType, value: discountValue },
    taxRatePercent: taxRatePercent === "" ? null : taxRatePercent,
  });
  const previewText = preview.ok ? formatInvoiceCurrencyAmount(preview.total, currency) : null;

  // Invoice Live Preview V1 — the document preview panel's own data,
  // built exclusively through buildInvoicePreviewTotals() (which itself
  // calls nothing but the existing calculateInvoiceTotals() and
  // buildInvoiceTotalsViewModel() — see that module's header comment).
  // No value here is computed a second time by hand.
  const previewResult = buildInvoicePreviewTotals({
    subtotalSource: mode === "flat" ? { mode: "flat", amount } : { mode: "lineItems", lineItems },
    discount: discountType === "NONE" ? { type: "NONE" } : { type: discountType, value: discountValue },
    taxRatePercent: taxRatePercent === "" ? null : taxRatePercent,
    currency,
    taxLabel,
  });
  const selectedClient = clients.find((client) => client.id === clientId);
  const selectedProject = projectId ? projectsForClient.find((project) => project.id === projectId) : undefined;
  // Invoice Live Preview V1 hydration correction: formatDateOnlyForDisplay()'s
  // `locale` defaults to the runtime's own default locale (its own doc
  // comment), which the server process and the visiting browser can — and
  // in Production, did — resolve differently, producing a genuine SSR/
  // hydration text mismatch (React #418) for these two display-only
  // strings. This is the same already-fixed defect class as commit
  // "Stabilize locale-dependent date rendering" (six other call sites,
  // all pinned to "en-US", matching this module's own currencies.ts
  // REFERENCE_LOCALE / pdf/view-model.ts PDF_LOCALE precedent) — neither
  // of those constants is exported/client-importable, so "en-US" is
  // pinned directly here, the same way that commit's own six call sites
  // did. Display-only: never affects parseDateOnly()/formatDateOnly()'s
  // own UTC date-only semantics, the persisted value, or any Server
  // Action payload.
  const issueDateDisplay = (() => {
    const parsed = parseDateOnly(issueDate);
    return parsed.ok ? formatDateOnlyForDisplay(parsed.date, "en-US") : null;
  })();
  const dueDateDisplay = (() => {
    const parsed = parseDateOnly(dueDate);
    return parsed.ok ? formatDateOnlyForDisplay(parsed.date, "en-US") : null;
  })();
  const flatServiceLabel = previewResult.ok ? previewResult.totals.displayedSubtotal : null;

  return (
    // Mobile line-item overflow fix — proven pre-existing at ~390px,
    // independent of any feature using this form (reproduces on an
    // unmodified blank Invoice with a populated itemized row; see the
    // narrow responsive audit). Below `lg:`, this wrapper previously had
    // no explicit base column count, so the single implicit grid track
    // got no `minmax(0, ...)` safeguard — its "automatic minimum size"
    // resolved to the min-content of the deepest populated line-item
    // input, which genuinely scales with the rendered value text, and
    // that min-content propagated all the way out to document-level
    // horizontal overflow. The explicit `grid-cols-1` base here matches
    // this app's own established safe pattern (QuoteForm/
    // RecurringInvoiceForm's own field-pair grids, and
    // InvoiceLineItemRow's own `sm:grid-cols-[...]`), giving the column
    // an explicit `minmax(0px, 1fr)` track below `lg:` so it can shrink
    // to the viewport instead of forcing document-level overflow.
    // InvoiceLineItemRow itself was never the cause — it already used
    // the safe pattern; QuoteForm and RecurringInvoiceForm reuse that
    // same row component but never this wrapper, and are unaffected.
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="mode" value={mode} />
        {mode === "itemized" && (
          <input type="hidden" name="lineItems" value={encodeInvoiceLineItemsFormValue(lineItems)} readOnly />
        )}

        <FormField label="Invoice number" htmlFor="invoiceNumber" required error={fieldErrors.invoiceNumber}>
          <Input
            id="invoiceNumber"
            name="invoiceNumber"
            value={invoiceNumber}
            onChange={(event) => {
              setInvoiceNumber(event.target.value);
              dismissCurrentErrors();
            }}
            required
            aria-invalid={!!fieldErrors.invoiceNumber}
            aria-describedby={fieldErrors.invoiceNumber ? "invoiceNumber-error" : undefined}
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
          {clientId && projectsForClient.length === 0 && (
            <p className="text-text-muted mt-1 text-xs">This client has no projects yet — that&rsquo;s fine, the invoice can stay project-less.</p>
          )}
        </FormField>

        <fieldset aria-describedby={fieldErrors.mode ? "mode-error" : undefined}>
          <legend className="text-text-secondary block text-sm font-medium">Invoice type</legend>
          <div className="mt-1 flex gap-4">
            <label className="text-text-secondary flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode-selector"
                checked={mode === "flat"}
                onChange={() => {
                  setMode("flat");
                  dismissCurrentErrors();
                }}
                className="focus-visible:ring-focus-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              />
              Flat amount
            </label>
            <label className="text-text-secondary flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode-selector"
                checked={mode === "itemized"}
                onChange={() => {
                  setMode("itemized");
                  dismissCurrentErrors();
                }}
                className="focus-visible:ring-focus-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              />
              Itemized
            </label>
          </div>
          {fieldErrors.mode && (
            <p id="mode-error" role="alert" className="text-danger mt-1 text-sm">
              {fieldErrors.mode}
            </p>
          )}
        </fieldset>

        {mode === "flat" ? (
          <FormField label="Amount" htmlFor="amount" required error={fieldErrors.amount}>
            <Input
              id="amount"
              name="amount"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                dismissCurrentErrors();
              }}
              required
              aria-invalid={!!fieldErrors.amount}
              aria-describedby={fieldErrors.amount ? "amount-error" : undefined}
            />
          </FormField>
        ) : (
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
                  errors={lineItemErrors[index]}
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
        )}

        <div aria-live="polite" className="border-border-default bg-surface-muted rounded-md border px-4 py-3 text-sm">
          {previewText ? (
            <span className="text-text-primary font-medium">Total: {previewText}</span>
          ) : (
            <span className="text-text-muted">Enter valid amounts to see a total preview.</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Issue date" htmlFor="issueDate" required error={fieldErrors.issueDate}>
            <Input
              id="issueDate"
              name="issueDate"
              type="date"
              value={issueDate}
              required
              onChange={(event) => {
                setIssueDate(event.target.value);
                dismissCurrentErrors();
              }}
              aria-invalid={!!fieldErrors.issueDate}
              aria-describedby={fieldErrors.issueDate ? "issueDate-error" : undefined}
            />
          </FormField>

          <FormField label="Due date" htmlFor="dueDate" error={fieldErrors.dueDate}>
            <Input
              id="dueDate"
              name="dueDate"
              type="date"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
                dismissCurrentErrors();
              }}
              aria-invalid={!!fieldErrors.dueDate}
              aria-describedby={fieldErrors.dueDate ? "dueDate-error" : undefined}
            />
          </FormField>
        </div>

        <details
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          className="group border-border-default rounded-md border"
        >
          <summary className="text-text-secondary flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Advanced options (currency, discount, tax, notes)
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
          </summary>

          <div className="space-y-4 border-t px-4 py-4 border-border-default">
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
              {currencyFallbackNotice && <p className="text-warning mt-1 text-sm">{currencyFallbackNotice}</p>}
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

      <div className="lg:sticky lg:top-6">
        <InvoicePreview
          invoiceNumber={invoiceNumber}
          issuerDisplayName={companyDisplayName ?? ""}
          clientName={selectedClient?.name ?? null}
          projectName={selectedProject?.label ?? null}
          currency={currency}
          issueDateDisplay={issueDateDisplay}
          dueDateDisplay={dueDateDisplay}
          mode={mode}
          lineItems={previewResult.ok ? previewResult.lineItems : []}
          flatServiceLabel={flatServiceLabel}
          result={previewResult}
          notes={notes.trim() ? notes : null}
        />
      </div>
    </div>
  );
}
