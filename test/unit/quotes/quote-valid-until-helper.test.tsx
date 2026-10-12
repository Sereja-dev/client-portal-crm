import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuoteForm } from "@/components/quotes/quote-form";
import { ToastProvider } from "@/components/toast/toast-provider";
import type { CreateQuoteResult } from "@/app/(dashboard)/quotes/actions";

/**
 * Forms Defaults + Helper Text — Quote "Valid until" accessible helper.
 * Reuses the exact FormField `description` + `describedByIds` pattern
 * shipped in commit 76535b4ba4d27dd9fe86f16569fe9e5c30e7a475 — no new
 * primitive behavior, so this file only proves this one field's own
 * wiring, not FormField/describedByIds themselves (already covered by
 * test/unit/form-field.test.tsx).
 *
 * QuoteForm is a Client Component that calls `useRouter()` (next/navigation)
 * and `useToast()` — unlike InvoiceForm/RecurringInvoiceForm, it has never
 * been direct-rendered in a unit test before this file. `useToast` is
 * satisfied with a real `<ToastProvider>` wrapper; `next/navigation`'s
 * `useRouter` is mocked below exactly as narrowly as this render needs
 * (a stable no-op `push`), consistent with this repo's own "no jsdom,
 * renderToStaticMarkup only" testing convention — no interaction is ever
 * simulated, so `push` is never expected to be called here.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

async function noopAction(): Promise<CreateQuoteResult> {
  return { ok: true, quoteId: "quote-1" };
}

function renderForm(props: Partial<Parameters<typeof QuoteForm>[0]> = {}) {
  return renderToStaticMarkup(
    <ToastProvider>
      <QuoteForm action={noopAction} leads={[]} clients={[]} currencyOptions={["USD"]} successToast="Quote created" {...props} />
    </ToastProvider>,
  );
}

describe("QuoteForm — Valid until accessible helper", () => {
  it("renders exactly the approved helper copy", () => {
    const html = renderForm();
    expect(html).toContain("After this date, an unaccepted quote is automatically marked Expired.");
  });

  it("the description renders with the stable id and the validUntil input references it via aria-describedby", () => {
    const html = renderForm();
    expect(html).toContain('id="validUntil-description"');
    expect(html).toMatch(/id="validUntil"[^>]*aria-describedby="validUntil-description"/);
  });

  it("the description id is never duplicated in the rendered markup", () => {
    const html = renderForm();
    const occurrences = html.split('id="validUntil-description"').length - 1;
    expect(occurrences).toBe(1);
  });
});

/**
 * The "error present -> aria-describedby composes both ids, description
 * first" shape (`"validUntil-description validUntil-error"`) is a generic
 * property of `describedByIds` itself, not anything specific to this
 * field — already proven by test/unit/form-field.test.tsx's own
 * "returns both ids, description first, space-separated, when both
 * apply" case. QuoteForm's own `fieldErrors` is local component state
 * (`useState<QuoteFieldErrors>({})`, no seeding prop) that can only ever
 * be populated by a real submit-and-settle cycle — this repo's own
 * established "no jsdom" limit (see form-helper-accessibility-migration.
 * test.tsx's identical header comment for InvoiceForm/RecurringInvoiceForm)
 * — so re-deriving the same composition here would just be a duplicate
 * proof, not a new one.
 */
