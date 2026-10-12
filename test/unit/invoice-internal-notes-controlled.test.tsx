import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import type { InvoiceFormState } from "@/types";

/**
 * Invoice internal-notes validation-reset remediation — focused unit
 * coverage for the controlled-state conversion of InvoiceForm's own
 * `internalNotes` field, the one remaining uncontrolled field in this
 * form. `react-dom/server` is this repo's own established convention
 * (no jsdom/testing-library exists here, see invoice-form-radio-focus.test.tsx's
 * own header comment) — a static render can prove the markup now uses
 * `value=` rather than a plain `defaultValue=` string, and that every
 * create/edit default still resolves to the exact same initial value as
 * before; the actual cross-settlement persistence behavior (the defect
 * itself) can only be proven by a real action round-trip, which is what
 * this fix's own Playwright E2E regression
 * (invoice-internal-notes-validation-reset.spec.ts) covers instead.
 */

async function noopAction(prev: InvoiceFormState): Promise<InvoiceFormState> {
  return prev;
}

function renderForm(defaultValues?: { internalNotes?: string }) {
  return renderToStaticMarkup(
    <InvoiceForm
      action={noopAction}
      clients={[{ id: "c1", name: "Client" }]}
      projects={[{ id: "p1", label: "Project", clientId: "c1" }]}
      currencyOptions={["USD", "EUR"]}
      defaultValues={defaultValues}
    />,
  );
}

describe("InvoiceForm — internalNotes renders from controlled state, never only defaultValue", () => {
  it("renders a real `value=` attribute for a persisted internal note", () => {
    const html = renderForm({ internalNotes: "Escalate to finance if unpaid." });
    expect(html).toMatch(/<textarea[^>]*id="internalNotes"[^>]*>Escalate to finance if unpaid\.<\/textarea>/);
  });

  it("keeps its exact existing name attribute", () => {
    const html = renderForm();
    expect(html).toContain('name="internalNotes"');
  });

  it("a clean create form with no defaultValues resolves internalNotes to blank, exactly as before", () => {
    const html = renderForm();
    expect(html).toMatch(/<textarea[^>]*id="internalNotes"[^>]*><\/textarea>/);
  });

  it("never renders a plain defaultValue= string for this field (the pre-fix, uncontrolled shape)", () => {
    const html = renderForm({ internalNotes: "Some note" });
    const textareaOpenTag = html.slice(html.indexOf('id="internalNotes"') - 20, html.indexOf(">", html.indexOf('id="internalNotes"')) + 1);
    expect(textareaOpenTag).not.toContain("defaultvalue");
  });
});
