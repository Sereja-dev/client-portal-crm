import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecurringInvoiceForm } from "@/components/recurring-invoices/recurring-invoice-form";
import type { RecurringInvoiceFormState } from "@/types";

/**
 * Forms Improvement Slice B1 — real render coverage (`react-dom/server`,
 * this repo's own established convention — no jsdom/testing-library
 * exists, see render.test.tsx's own header comment) for the new section
 * structure and "Advanced options" progressive disclosure. A single
 * static render always starts with whatever `open` the component's own
 * deterministic initial-state logic computes — exactly what's needed to
 * prove the create/edit auto-open behavior; true interactive
 * open/close/toggle behavior is covered by this slice's own Playwright
 * E2E spec instead.
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

describe("RecurringInvoiceForm — section structure", () => {
  it("renders four section legends in order: Schedule, Invoice numbering & due date, Invoice contents, Advanced options", () => {
    const html = renderForm();
    const scheduleIndex = html.indexOf("Schedule</legend>");
    const numberingIndex = html.indexOf("Invoice numbering");
    const contentsIndex = html.indexOf("Invoice contents</legend>");
    const advancedIndex = html.indexOf("Advanced options");
    expect(scheduleIndex).toBeGreaterThan(-1);
    expect(numberingIndex).toBeGreaterThan(scheduleIndex);
    expect(contentsIndex).toBeGreaterThan(numberingIndex);
    expect(advancedIndex).toBeGreaterThan(contentsIndex);
  });

  it("every field keeps its exact existing name attribute regardless of section wrapping", () => {
    const html = renderForm();
    for (const name of [
      "name",
      "clientId",
      "projectId",
      "frequency",
      "firstIssueDate",
      "invoiceNumberPrefix",
      "startingSequence",
      "dueDateOffsetDays",
      "lineItems",
      "currency",
      "discountType",
      "taxRatePercent",
      "taxLabel",
      "notes",
      "internalNotes",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
  });

  it("Currency remains outside the Advanced disclosure — it renders before the <details> element, not inside it", () => {
    const html = renderForm();
    const currencyIndex = html.indexOf('name="currency"');
    const detailsIndex = html.indexOf("<details");
    expect(currencyIndex).toBeGreaterThan(-1);
    expect(detailsIndex).toBeGreaterThan(-1);
    expect(currencyIndex).toBeLessThan(detailsIndex);
  });
});

describe("RecurringInvoiceForm — Advanced options default/initial state", () => {
  it("a clean create form (no defaultValues) renders the disclosure CLOSED", () => {
    const html = renderForm();
    const detailsTag = html.slice(html.indexOf("<details"), html.indexOf("<details") + 60);
    expect(detailsTag).not.toMatch(/\bopen\b/);
  });

  it("an edit form with every advanced value at its default/empty state also renders CLOSED", () => {
    const html = renderForm({
      mode: "edit",
      defaultValues: { discountType: "NONE", taxRatePercent: "", notes: "", internalNotes: "" },
    });
    const detailsTag = html.slice(html.indexOf("<details"), html.indexOf("<details") + 60);
    expect(detailsTag).not.toMatch(/\bopen\b/);
  });

  it("a persisted non-default discountType opens the disclosure automatically", () => {
    const html = renderForm({ mode: "edit", defaultValues: { discountType: "PERCENTAGE", discountValue: "10" } });
    const detailsTag = html.slice(html.indexOf("<details"), html.indexOf("<details") + 60);
    expect(detailsTag).toMatch(/\bopen=""/);
  });

  it("a persisted non-empty taxRatePercent opens the disclosure automatically", () => {
    const html = renderForm({ mode: "edit", defaultValues: { taxRatePercent: "8.25" } });
    const detailsTag = html.slice(html.indexOf("<details"), html.indexOf("<details") + 60);
    expect(detailsTag).toMatch(/\bopen=""/);
  });

  it("persisted non-empty Notes opens the disclosure automatically", () => {
    const html = renderForm({ mode: "edit", defaultValues: { notes: "Thanks for your business!" } });
    const detailsTag = html.slice(html.indexOf("<details"), html.indexOf("<details") + 60);
    expect(detailsTag).toMatch(/\bopen=""/);
  });

  it("persisted non-empty Internal notes opens the disclosure automatically", () => {
    const html = renderForm({ mode: "edit", defaultValues: { internalNotes: "Escalate to finance if unpaid." } });
    const detailsTag = html.slice(html.indexOf("<details"), html.indexOf("<details") + 60);
    expect(detailsTag).toMatch(/\bopen=""/);
  });

  it("initial open state is fully deterministic from defaultValues alone — identical defaultValues always produce the identical open/closed markup (no hydration-risking randomness)", () => {
    const defaultValues = { taxRatePercent: "5" };
    const first = renderForm({ mode: "edit", defaultValues });
    const second = renderForm({ mode: "edit", defaultValues });
    expect(first).toBe(second);
  });
});
