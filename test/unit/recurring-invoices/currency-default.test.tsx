import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecurringInvoiceForm } from "@/components/recurring-invoices/recurring-invoice-form";
import { resolveInvoiceCurrencyDefault } from "@/lib/invoices/currencies";
import type { RecurringInvoiceFormState } from "@/types";

/**
 * Forms Defaults + Helper Text — Recurring Invoice currency default.
 *
 * Before this fix, `src/app/(dashboard)/recurring-invoices/new/page.tsx`
 * passed no `defaultValues` at all, so RecurringInvoiceForm's own
 * `useState(defaultValues?.currency ?? currencyOptions[0] ?? "USD")`
 * silently fell back to `currencyOptions[0]` — the alphabetically-first
 * supported currency ("AED"), never the organization's own currency.
 * The fix is entirely in the Server Component page (now calls
 * `getCompanyProfile` + `resolveInvoiceCurrencyDefault`, the exact same
 * mechanism Invoice/Quote's own `new/page.tsx` already use, and passes
 * the result into `defaultValues.currency`); RecurringInvoiceForm's own
 * rendering is unchanged. These tests prove the render-level half of
 * that contract — that whatever currency the page resolves and passes
 * in is what actually renders — using the same `renderToStaticMarkup`
 * convention as every other RecurringInvoiceForm unit test (no jsdom in
 * this repo).
 */

async function noopAction(): Promise<RecurringInvoiceFormState> {
  return { error: null };
}

const clients = [{ id: "client-a", name: "Acme Co" }];
const projects = [{ id: "project-a", label: "Website Redesign", clientId: "client-a" }];

// Deliberately AED-first, mirroring getSupportedInvoiceCurrencies()'s own
// real alphabetical order — so a test that still observes AED proves
// nothing (it would also pass pre-fix); only a non-AED result proves the
// organization-currency default actually won.
const currencyOptions = ["AED", "EUR", "GBP", "USD"];

function renderForm(props: Partial<Parameters<typeof RecurringInvoiceForm>[0]> = {}) {
  return renderToStaticMarkup(
    <RecurringInvoiceForm mode="create" action={noopAction} clients={clients} projects={projects} currencyOptions={currencyOptions} {...props} />,
  );
}

function hiddenCurrencyInput(html: string): string {
  const match = html.match(/<input type="hidden" name="currency" value="([^"]*)"/);
  if (!match) throw new Error("currency hidden input not found in rendered markup");
  return match[1];
}

describe("RecurringInvoiceForm create — currency default", () => {
  it("renders the organization's own currency (USD) — not AED — when the page passes it via defaultValues", () => {
    const html = renderForm({ defaultValues: { currency: "USD" } });
    expect(hiddenCurrencyInput(html)).toBe("USD");
  });

  it("works generically for another valid organization currency (GBP)", () => {
    const html = renderForm({ defaultValues: { currency: "GBP" } });
    expect(hiddenCurrencyInput(html)).toBe("GBP");
  });

  it("composes with the real resolveInvoiceCurrencyDefault fallback semantics: an absent/unsupported organization currency still resolves to USD, not AED", () => {
    // Exercises the actual resolver (no duplicated fallback logic here) —
    // resolveInvoiceCurrencyDefault's own exhaustive fallback-semantics
    // coverage already lives in test/unit/invoice-currencies.test.ts;
    // this proves the page's full composition (resolver output ->
    // defaultValues.currency -> rendered value) end to end.
    const currencyDefault = resolveInvoiceCurrencyDefault(null);
    expect(currencyDefault.currency).toBe("USD");
    expect(currencyDefault.isFallback).toBe(true);

    const html = renderForm({ defaultValues: { currency: currencyDefault.currency } });
    expect(hiddenCurrencyInput(html)).toBe("USD");
  });

  it("without any defaultValues at all, still falls back to currencyOptions[0] (AED) — the page, not the form, is responsible for passing the organization default", () => {
    const html = renderForm();
    expect(hiddenCurrencyInput(html)).toBe("AED");
  });
});

describe("RecurringInvoiceForm edit — currency is unaffected (persisted value always wins)", () => {
  it("renders the persisted schedule currency exactly, regardless of what the current organization default would be", () => {
    const html = renderForm({ mode: "edit", defaultValues: { currency: "EUR" } });
    expect(hiddenCurrencyInput(html)).toBe("EUR");
  });
});

describe("RecurringInvoiceForm create — firstIssueDate stays genuinely blank", () => {
  it("a fresh create render (currency prefilled, no other defaultValues) still renders firstIssueDate as an empty controlled value", () => {
    const html = renderForm({ defaultValues: { currency: "USD" } });
    expect(html).toMatch(/<input[^>]*id="firstIssueDate"[^>]*value=""/);
    // Not asserting anything about native browser presentation (e.g.
    // Safari's own empty-date-field rendering) — only the actual
    // server-rendered DOM/controlled-state value, which is what Product
    // code owns.
  });
});
