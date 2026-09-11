import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecurringInvoiceForm } from "@/components/recurring-invoices/recurring-invoice-form";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import type { RecurringInvoiceFormState } from "@/types";

/**
 * Recurring Invoices Phase 2A — genuine render coverage (test items 16
 * partial, 43, 47), same renderToStaticMarkup approach as
 * test/unit/time-entries/render.test.tsx's own established precedent
 * (this repo has no DOM/component-interaction harness). RecurringInvoiceForm
 * itself calls no next/navigation hooks (only useActionState/useState), so
 * it renders cleanly, unlike an async Server Component page (the detail/
 * list pages themselves aren't render-tested here for that reason — same
 * documented limitation TimeEntryForm's own render.test.tsx already
 * established for anything needing the real Next.js server runtime).
 */

async function noopAction(): Promise<RecurringInvoiceFormState> {
  return { error: null };
}

const clients = [{ id: "client-a", name: "Acme Co" }];
const projects = [{ id: "project-a", label: "Website Redesign", clientId: "client-a" }];

describe("16. RecurringInvoiceForm — edit mode never renders the unsupported schedule-date fields", () => {
  it("create mode renders frequency, first issue date, and starting number", () => {
    const html = renderToStaticMarkup(
      <RecurringInvoiceForm mode="create" action={noopAction} clients={clients} projects={projects} currencyOptions={["USD"]} />,
    );
    expect(html).toContain('name="frequency"');
    expect(html).toContain('name="firstIssueDate"');
    expect(html).toContain('name="startingSequence"');
  });

  it("edit mode renders none of them", () => {
    const html = renderToStaticMarkup(
      <RecurringInvoiceForm mode="edit" action={noopAction} clients={clients} projects={projects} currencyOptions={["USD"]} />,
    );
    expect(html).not.toContain('name="frequency"');
    expect(html).not.toContain('name="firstIssueDate"');
    expect(html).not.toContain('name="startingSequence"');
    // The still-editable fields remain present in edit mode.
    expect(html).toContain('name="invoiceNumberPrefix"');
    expect(html).toContain('name="dueDateOffsetDays"');
  });
});

describe("RecurringInvoiceForm — next invoice number preview", () => {
  it("shows a plain composed preview, never candidate/attempt/collision language", () => {
    const html = renderToStaticMarkup(
      <RecurringInvoiceForm
        mode="edit"
        action={noopAction}
        clients={clients}
        projects={projects}
        currencyOptions={["USD"]}
        defaultValues={{ invoiceNumberPrefix: "INV-", startingSequence: 6 }}
      />,
    );
    expect(html).toContain("Next invoice: INV-6");
    expect(html.toLowerCase()).not.toContain("candidate");
    expect(html.toLowerCase()).not.toContain("attempt");
    expect(html.toLowerCase()).not.toContain("collision");
  });
});

describe("43. Archived/Paused status renders via the shared StatusBadge", () => {
  it("PAUSED renders a real, visible 'Paused' badge", () => {
    const html = renderToStaticMarkup(<StatusBadge status="PAUSED" />);
    expect(html).toContain("Paused");
  });
  it("ARCHIVED and ACTIVE still render correctly (reused, unmodified tones)", () => {
    expect(renderToStaticMarkup(<StatusBadge status="ARCHIVED" />)).toContain("Archived");
    expect(renderToStaticMarkup(<StatusBadge status="ACTIVE" />)).toContain("Active");
  });
});

describe("47. generated-invoice history row renders ordinary Invoice status/number/date/total", () => {
  it("renders the exact same primitives the detail page's own history table uses", () => {
    const html = renderToStaticMarkup(
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Invoice number</TableHeaderCell>
            <TableHeaderCell>Issue date</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell align="right">Total</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell emphasis>INV-6</TableCell>
            <TableCell>{formatDateOnlyForDisplay(new Date("2027-03-15T00:00:00.000Z"))}</TableCell>
            <TableCell>
              <StatusBadge status="DRAFT" />
            </TableCell>
            <TableCell align="right">{formatInvoiceCurrencyAmount("534.60", "USD")}</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(html).toContain("INV-6");
    expect(html).toContain("Draft");
    expect(html).toContain("$534.60");
  });
});
