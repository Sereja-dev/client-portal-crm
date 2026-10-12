import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { RecurringInvoiceForm } from "@/components/recurring-invoices/recurring-invoice-form";
import type { InvoiceFormState } from "@/types";
import type { RecurringInvoiceFormState } from "@/types";

/**
 * Forms Helper-Text Accessibility remediation — real-render proof that
 * the six migrated fields correctly compose `aria-describedby` from the
 * shared `FormField`/`describedByIds` repair, across a static
 * description, a conditional description, and a custom-control
 * (`SearchableSelect`) field.
 *
 * `useActionState`'s own `fieldErrors`/error state can only ever be
 * seeded by actually dispatching and awaiting the action — this repo
 * has no jsdom, so no interactive submit-and-settle cycle can be driven
 * from a unit test (the repo's own established convention is Playwright
 * for anything requiring that; see RecurringInvoiceForm/InvoiceForm's
 * own existing E2E suites). The "conditional description absent +
 * validation error present" combination (e.g. Frequency = WEEKLY with a
 * frequency error) is therefore proven at the level that actually
 * decides it — `describedByIds`'s own unit coverage in
 * test/unit/form-field.test.tsx already covers exactly this shape
 * ("returns only the error id when the description is conditionally
 * absent") — rather than attempting an expensive, duplicate simulation
 * here.
 */

async function noopInvoiceAction(prev: InvoiceFormState): Promise<InvoiceFormState> {
  return prev;
}

async function noopRecurringAction(prev: RecurringInvoiceFormState): Promise<RecurringInvoiceFormState> {
  return prev;
}

describe("RecurringInvoiceForm — static description (Due date offset)", () => {
  it("the Input's aria-describedby references the description id, which is actually rendered", () => {
    const html = renderToStaticMarkup(
      <RecurringInvoiceForm mode="create" action={noopRecurringAction} clients={[]} projects={[]} currencyOptions={["USD"]} />,
    );
    expect(html).toContain('id="dueDateOffsetDays-description"');
    expect(html).toMatch(/id="dueDateOffsetDays"[^>]*aria-describedby="dueDateOffsetDays-description"/);
  });
});

describe("RecurringInvoiceForm — conditional description (Frequency)", () => {
  it("non-WEEKLY (the default): frequency-description exists and is referenced", () => {
    const html = renderToStaticMarkup(
      <RecurringInvoiceForm mode="create" action={noopRecurringAction} clients={[]} projects={[]} currencyOptions={["USD"]} />,
    );
    expect(html).toContain('id="frequency-description"');
    expect(html).toMatch(/id="frequency"[^>]*aria-describedby="frequency-description"/);
  });

  it("WEEKLY: the description paragraph is absent, and frequency-description is NOT referenced (no dangling id)", () => {
    const html = renderToStaticMarkup(
      <RecurringInvoiceForm
        mode="create"
        action={noopRecurringAction}
        clients={[]}
        projects={[]}
        currencyOptions={["USD"]}
        defaultValues={{ frequency: "WEEKLY" }}
      />,
    );
    expect(html).not.toContain("frequency-description");
    // No error and no description -> no aria-describedby attribute at all.
    expect(html).toMatch(/id="frequency"(?:(?!aria-describedby)[^>])*>/);
  });
});

describe("InvoiceForm — custom control description (Project / SearchableSelect)", () => {
  it("pristine (no client selected): no project-less description, nothing referenced", () => {
    const html = renderToStaticMarkup(
      <InvoiceForm
        action={noopInvoiceAction}
        clients={[{ id: "c1", name: "Client" }]}
        projects={[]}
        currencyOptions={["USD", "EUR"]}
      />,
    );
    expect(html).not.toContain("projectId-description");
  });

  it("a client with zero projects selected: projectId-description exists and the combobox references it", () => {
    const html = renderToStaticMarkup(
      <InvoiceForm
        action={noopInvoiceAction}
        clients={[{ id: "c1", name: "Client" }]}
        projects={[]}
        currencyOptions={["USD", "EUR"]}
        defaultValues={{ clientId: "c1" }}
      />,
    );
    expect(html).toContain('id="projectId-description"');
    expect(html).toContain("This client has no projects yet");
    expect(html).toMatch(/id="projectId"[^>]*aria-describedby="projectId-description"/);
  });
});
