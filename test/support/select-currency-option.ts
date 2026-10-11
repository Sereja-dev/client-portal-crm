import type { Page } from "@playwright/test";

/**
 * Forms Improvement Slice A1 — the Currency field on Invoice, Recurring
 * Invoice, Quote, and Company Settings is no longer a native `<select>`
 * (see `src/components/ui/searchable-select.tsx` and
 * `src/components/invoices/currency-select.tsx`); Playwright's own
 * `.selectOption()` only targets a real `<select>` element, so every E2E
 * spec that previously drove Currency that way needs this equivalent
 * sequence instead: focus the field (opens the listbox), type the exact
 * code to filter down to it, then click the matching option. The
 * field's own closed-state displayed value is always just the bare
 * currency code (e.g. "EUR") — unchanged by this slice — so existing
 * `toHaveValue(code)` assertions elsewhere in this suite still pass
 * without needing this helper.
 */
export async function selectCurrencyOption(page: Page, label: string, code: string): Promise<void> {
  const field = page.getByLabel(label);
  await field.click();
  await field.fill(code);
  await page.getByRole("option", { name: code, exact: true }).click();
}
