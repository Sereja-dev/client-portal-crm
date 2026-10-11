import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecurringInvoiceForm } from "@/components/recurring-invoices/recurring-invoice-form";
import type { RecurringInvoiceFormState } from "@/types";

/**
 * Recurring Invoice validation-reset remediation — focused unit coverage
 * for the controlled-state conversion of the six previously-uncontrolled
 * fields (name, firstIssueDate, dueDateOffsetDays, taxLabel, notes,
 * internalNotes). `react-dom/server` is this repo's own established
 * convention (no jsdom/testing-library exists here) — a static render
 * can prove the markup now uses `value=` rather than a plain
 * `defaultValue=` string, and that every create/edit default still
 * resolves to the exact same initial value as before; the actual
 * cross-settlement persistence behavior (the defect itself) can only be
 * proven by a real action round-trip, which is what this fix's own
 * Playwright E2E regression (recurring-invoice-validation-reset.spec.ts)
 * covers instead.
 */

async function noopAction(): Promise<RecurringInvoiceFormState> {
  return { error: null };
}

const clients = [{ id: "client-a", name: "Acme Co" }];
const projects = [{ id: "project-a", label: "Website Redesign", clientId: "client-a" }];

function renderForm(props: Partial<Parameters<typeof RecurringInvoiceForm>[0]> = {}) {
  return renderToStaticMarkup(
    <RecurringInvoiceForm
      mode="create"
      action={noopAction}
      clients={clients}
      projects={projects}
      currencyOptions={["USD"]}
      {...props}
    />,
  );
}

describe("RecurringInvoiceForm — formerly-uncontrolled fields now render from controlled state", () => {
  it("name, dueDateOffsetDays, notes, internalNotes render a real `value=` attribute, never only `defaultValue=`", () => {
    const html = renderForm({
      defaultValues: { name: "A schedule", dueDateOffsetDays: 7, notes: "A note", internalNotes: "Internal note" },
    });
    expect(html).toMatch(/<input[^>]*id="name"[^>]*value="A schedule"/);
    expect(html).toMatch(/<input[^>]*id="dueDateOffsetDays"[^>]*value="7"/);
    expect(html).toMatch(/<textarea[^>]*id="notes"[^>]*>A note<\/textarea>/);
    expect(html).toMatch(/<textarea[^>]*id="internalNotes"[^>]*>Internal note<\/textarea>/);
  });

  it("firstIssueDate (create mode) renders a real `value=` attribute", () => {
    const html = renderForm({ defaultValues: { firstIssueDate: "2027-05-01" } });
    expect(html).toMatch(/<input[^>]*id="firstIssueDate"[^>]*value="2027-05-01"/);
  });

  it("taxLabel renders the persisted option as selected via controlled value, not a bare defaultValue attribute", () => {
    const html = renderForm({ mode: "edit", defaultValues: { taxLabel: "VAT" } });
    const selectBlock = html.slice(html.indexOf('id="taxLabel"'), html.indexOf("</select>", html.indexOf('id="taxLabel"')));
    expect(selectBlock).toContain('<option value="VAT" selected');
  });

  it("every affected field keeps its exact existing name attribute", () => {
    const html = renderForm();
    for (const name of ["name", "firstIssueDate", "dueDateOffsetDays", "taxLabel", "notes", "internalNotes"]) {
      expect(html).toContain(`name="${name}"`);
    }
  });

  it("create mode with no defaultValues resolves every affected field to its exact pre-fix default (blank, or TAX for taxLabel)", () => {
    const html = renderForm();
    expect(html).toMatch(/<input[^>]*id="name"[^>]*value=""/);
    expect(html).toMatch(/<input[^>]*id="dueDateOffsetDays"[^>]*value=""/);
    const taxLabelBlock = html.slice(html.indexOf('id="taxLabel"'), html.indexOf("</select>", html.indexOf('id="taxLabel"')));
    expect(taxLabelBlock).toContain('<option value="TAX" selected');
  });

  it("edit mode with a persisted dueDateOffsetDays of 0 renders '0', not blank (a real 0, not a falsy-coerced empty string)", () => {
    const html = renderForm({ mode: "edit", defaultValues: { dueDateOffsetDays: 0 } });
    expect(html).toMatch(/<input[^>]*id="dueDateOffsetDays"[^>]*value="0"/);
  });

  it("edit mode never renders the create-only firstIssueDate field at all, regardless of the controlled-state conversion", () => {
    const html = renderForm({ mode: "edit", defaultValues: { firstIssueDate: "2027-05-01" } });
    expect(html).not.toContain('name="firstIssueDate"');
  });
});

/**
 * Corrective pass — the comprehensive field inventory found two more
 * native `<select>` fields affected by the same DOM-reconciliation
 * quirk already fixed for `taxLabel`: `frequency` and `discountType`.
 * Both were already controlled before this pass (React state was never
 * actually at risk — only the DOM's own display drifted), so there's
 * no create/edit-default-resolution regression to prove here beyond
 * what already existed; these two tests just document that both still
 * render their persisted option as selected, exactly like taxLabel's
 * own test above. The actual cross-settlement DOM-survival behavior
 * (the defect itself) is proven by the Playwright E2E regression, not
 * a static render.
 */
describe("RecurringInvoiceForm — the other two native <select> fields found by the comprehensive inventory", () => {
  it("frequency (create mode) renders the persisted option as selected via controlled value", () => {
    const html = renderForm({ defaultValues: { frequency: "QUARTERLY" } });
    const selectBlock = html.slice(html.indexOf('id="frequency"'), html.indexOf("</select>", html.indexOf('id="frequency"')));
    expect(selectBlock).toContain('<option value="QUARTERLY" selected');
  });

  it("discountType renders the persisted option as selected via controlled value", () => {
    const html = renderForm({ mode: "edit", defaultValues: { discountType: "FIXED", discountValue: "5.00" } });
    const selectBlock = html.slice(html.indexOf('id="discountType"'), html.indexOf("</select>", html.indexOf('id="discountType"')));
    expect(selectBlock).toContain('<option value="FIXED" selected');
  });
});
