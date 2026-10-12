"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { InvoiceLineItemRow } from "@/components/invoices/invoice-line-item-row";
import { CurrencySelect } from "@/components/invoices/currency-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/components/toast/toast-provider";
import { withToast } from "@/lib/toast-url";
import { INVOICE_DISCOUNT_TYPES, INVOICE_TAX_LABELS } from "@/lib/validation/invoice";
import { calculateQuoteTotals } from "@/lib/quotes/calculations";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { parseDateOnly, formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { buildQuotePreviewTotals } from "@/lib/quotes/quote-preview-view-model";
import type { InvoiceLineItemFormValue } from "@/lib/invoices/line-items-form";
import type { QuoteFieldErrors, QuoteItemErrors, QuoteWritableInput } from "@/lib/validation/quote";
import type { CreateQuoteResult, UpdateQuoteResult } from "@/app/(dashboard)/quotes/actions";
import { QuotePreview } from "./quote-preview";
import { deepEqual } from "@/lib/forms/deep-equal";
import { useUnsavedChangesScope } from "@/components/forms/unsaved-changes-scope";
import { useReportDirtyState } from "@/components/forms/use-report-dirty-state";

const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

const BLANK_LINE_ITEM: InvoiceLineItemFormValue = { description: "", quantity: "", unitPrice: "" };

/**
 * Forms Improvement Slice B2 — `name` added alongside the existing
 * `label` (the already-formatted "Jane Doe — Acme Inc (jane@acme.com)"
 * string used for the dropdown option text) so the live preview can show
 * a plain target name without parsing that concatenated string back
 * apart. Every caller already has this raw field in hand from its own
 * existing Prisma query (`lead.name`/`client.name`) — this costs no new
 * query, just one more mapped property.
 */
export type QuoteTargetOption = { id: string; label: string; name: string };

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
 * Forms Improvement Slice C1a — the normalized shape QuoteForm's own
 * dirty-state comparison is built from, covering every Product-
 * editable/submitted field (never presentation state — fieldErrors/
 * itemErrors and every B2-preview-derived value are deliberately
 * excluded; see this component's own `isDirty` comment below). Target
 * is normalized to `{ targetType, targetId }` rather than comparing
 * `leadId`/`clientId` independently — switching target type clears the
 * inactive side immediately (handleTargetTypeChange's own existing
 * behavior), so comparing the inactive side's own value would only ever
 * produce a false dirty reading for a field the user can no longer even
 * see.
 */
export type QuoteDirtySnapshot = {
  targetType: "lead" | "client" | null;
  targetId: string;
  number: string;
  title: string;
  issueDate: string;
  validUntil: string;
  currency: string;
  items: InvoiceLineItemFormValue[];
  discountType: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue: string;
  taxRatePercent: string;
  taxLabel: "TAX" | "VAT" | "GST";
  notes: string;
};

export function buildQuoteDirtySnapshot(values: {
  targetType: "lead" | "client" | null;
  leadId: string;
  clientId: string;
  number: string;
  title: string;
  issueDate: string;
  validUntil: string;
  currency: string;
  items: InvoiceLineItemFormValue[];
  discountType: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue: string;
  taxRatePercent: string;
  taxLabel: "TAX" | "VAT" | "GST";
  notes: string;
}): QuoteDirtySnapshot {
  return {
    targetType: values.targetType,
    targetId: values.targetType === "lead" ? values.leadId : values.targetType === "client" ? values.clientId : "",
    number: values.number,
    title: values.title,
    issueDate: values.issueDate,
    validUntil: values.validUntil,
    currency: values.currency,
    items: values.items,
    discountType: values.discountType,
    // discountValue's own FormField isn't even rendered while
    // discountType is NONE — a leftover/stale string there is never
    // something the user could currently see or have just edited.
    discountValue: values.discountType === "NONE" ? "" : values.discountValue,
    taxRatePercent: values.taxRatePercent,
    taxLabel: values.taxLabel,
    notes: values.notes,
  };
}

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
  companyDisplayName,
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
  /**
   * Forms Improvement Slice B2 — the company profile's own display name
   * (Organization.name, the same field getCompanyProfile() already
   * returns), shown as the live preview's "From" identity — mirrors
   * InvoiceForm's own identical `companyDisplayName` prop exactly.
   * Optional, with a generic "Your company" placeholder when omitted, so
   * every existing caller of this component (including direct-render
   * unit tests that construct QuoteForm without this prop) keeps working
   * unchanged.
   */
  companyDisplayName?: string;
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
  // Forms Improvement Slice A2.3 — the exact same already-fetched Client
  // list, mapped onto SearchableSelect's own flat option shape. A single
  // trivial line — no separate helper file, matching this slice's own
  // "don't create a new relational-options abstraction merely for a
  // third similar file" instruction.
  const clientOptions = clients.map((client) => ({ value: client.id, label: client.label }));

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

  // Forms Improvement Slice B2 — the document preview panel's own data,
  // built exclusively through buildQuotePreviewTotals() (itself a thin
  // re-export of Invoice's own buildInvoicePreviewTotals() — see that
  // module's header comment). No value here is computed a second time by
  // hand, and this is entirely separate local state from nothing — it is
  // derived directly from the exact same `items`/`discountType`/
  // `discountValue`/`taxRatePercent`/`currency`/`taxLabel` state above on
  // every render, with no new state and no effect.
  const previewResult = buildQuotePreviewTotals({
    subtotalSource: { mode: "lineItems", lineItems: items },
    discount: discountType === "NONE" ? { type: "NONE" } : { type: discountType, value: discountValue },
    taxRatePercent: taxRatePercent === "" ? null : taxRatePercent,
    currency,
    taxLabel,
  });
  const selectedLead = targetType === "lead" ? leads.find((lead) => lead.id === leadId) : undefined;
  const selectedClient = targetType === "client" ? clients.find((client) => client.id === clientId) : undefined;
  const targetTypeLabel: "Lead" | "Client" | null = targetType === "lead" ? "Lead" : targetType === "client" ? "Client" : null;
  const targetName = selectedLead?.name ?? selectedClient?.name ?? null;
  // Forms Improvement Slice B2 hydration correction — formatDateOnlyForDisplay()'s
  // `locale` defaults to the runtime's own default locale, which the
  // server process and the visiting browser can — and in Production,
  // did, for Invoice's own identical call sites — resolve differently,
  // producing a genuine SSR/hydration text mismatch (React #418) for
  // these two display-only strings. Same already-fixed defect class as
  // InvoiceForm's own "Invoice Live Preview V1 hydration correction"
  // comment; "en-US" is pinned explicitly here for the same reason.
  // Display-only: never affects parseDateOnly()/formatDateOnly()'s own
  // UTC date-only semantics, the persisted value, or the submitted
  // QuoteWritableInput.
  const issueDateDisplay = (() => {
    const parsed = parseDateOnly(issueDate);
    return parsed.ok ? formatDateOnlyForDisplay(parsed.date, "en-US") : null;
  })();
  const validUntilDisplay = (() => {
    const parsed = parseDateOnly(validUntil);
    return parsed.ok ? formatDateOnlyForDisplay(parsed.date, "en-US") : null;
  })();

  // Forms Improvement Slice C1a — semantic dirty detection, mirroring
  // InvoiceForm's own identical approach. Captured once at mount as the
  // baseline (useState's own lazy initializer) — including the mount
  // QuoteSentPanel performs once "Edit quote" is confirmed (that fresh
  // QuoteForm instance's own first render IS its own clean baseline, no
  // special-case code needed) and the remount a template application
  // triggers (via the caller's own `key={appliedTemplateId ?? "blank"}`).
  // Compared every render against the same snapshot shape built from
  // current state.
  const currentDirtySnapshot = buildQuoteDirtySnapshot({
    targetType,
    leadId,
    clientId,
    number,
    title,
    issueDate,
    validUntil,
    currency,
    items,
    discountType,
    discountValue,
    taxRatePercent,
    taxLabel,
    notes,
  });
  const [initialDirtySnapshot] = useState(() => currentDirtySnapshot);
  const isDirty = !deepEqual(currentDirtySnapshot, initialDirtySnapshot);
  const unsavedChangesScope = useUnsavedChangesScope();
  useReportDirtyState(isDirty);

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
        // Forms Improvement Slice C1a — an explicit, narrow safety net:
        // real client-side App Router transitions never fire
        // `beforeunload` in the first place (this slice's own readiness
        // audit, §C/§P), so this isn't strictly required for correctness
        // today, but clearing it here deterministically tears down any
        // active beforeunload listener the instant a save is known to
        // have actually succeeded — never merely because submit was
        // clicked or the transition started (see the validation/rate-
        // limit/etc. branches below, none of which touch this).
        unsavedChangesScope?.setIsDirty(false);
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
    // Forms Improvement Slice B2 — mirrors InvoiceForm's own identical
    // two-column live-preview layout exactly (grid-cols-1 base so the
    // column has an explicit minmax(0px, 1fr) track below `lg:`, the
    // same mobile-overflow safeguard InvoiceForm's own header comment
    // documents): form left, preview right, sticky on desktop, preview
    // stacks below the form on narrower viewports.
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
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
              <SearchableSelect
                id="target-client-select"
                value={clientId}
                onChange={(next) => {
                  setClientId(next);
                  dismissErrors();
                }}
                options={clientOptions}
                required
                placeholder="Search clients…"
                emptyMessage="No matching clients"
                aria-invalid={!!fieldErrors.target}
              />
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
          <CurrencySelect
            id="currency"
            value={currency}
            onChange={(next) => {
              setCurrency(next);
              dismissErrors();
            }}
            supportedCurrencies={currencyOptions}
            required
            aria-invalid={!!fieldErrors.currency}
            aria-describedby={fieldErrors.currency ? "currency-error" : undefined}
          />
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

      <div className="lg:sticky lg:top-6">
        <QuotePreview
          quoteNumber={number}
          issuerDisplayName={companyDisplayName ?? ""}
          title={title.trim() ? title : null}
          targetTypeLabel={targetTypeLabel}
          targetName={targetName}
          currency={currency}
          issueDateDisplay={issueDateDisplay}
          validUntilDisplay={validUntilDisplay}
          lineItems={previewResult.ok ? previewResult.lineItems : []}
          result={previewResult}
          notes={notes.trim() ? notes : null}
        />
      </div>
    </div>
  );
}
