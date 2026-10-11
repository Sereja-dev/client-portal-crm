import type { Page } from "@playwright/test";

/**
 * Forms Improvement Slice A2.1 — a generic helper for any field built on
 * the shared SearchableSelect primitive (src/components/ui/
 * searchable-select.tsx), first needed here for the Invoice Client/
 * Project selectors. Deliberately NOT named after currency and
 * deliberately a NEW, separate helper rather than a refactor of
 * test/support/select-currency-option.ts — that one stays exactly as it
 * is, scoped to its own existing callers, per this slice's own "avoid
 * broad mechanical churn" instruction.
 *
 * Two modes, both type into the field to filter the listbox and then
 * click a real rendered option — free-typed text alone can never commit
 * (the underlying primitive structurally doesn't allow it):
 *   - `optionName` given: click the option with that exact visible text
 *     — the realistic "a person types a name, picks the matching result"
 *     path.
 *   - `optionName` omitted: click whichever single option the query
 *     narrowed the list down to. SearchableSelect's own search matches
 *     against both an option's `value` AND its `label` (see
 *     matchesSearchableOption), so typing a fixture's raw id narrows the
 *     list to exactly one match even though the visible option text is
 *     a name, not the id — the same shortcut `.selectOption(id)` already
 *     was for the retired native `<select>`.
 *
 * Uses `getByRole("combobox", { name: label })`, not `getByLabel(label)`:
 * the open listbox carries its own `aria-label={placeholder}` (e.g.
 * "Search clients…"), and a short field label like "Client" is a
 * case-insensitive substring of that placeholder text once pluralized —
 * `getByLabel`'s default substring matching would then ambiguously
 * resolve to both the input AND the listbox. Role-scoping to `combobox`
 * sidesteps that entirely (the listbox's role is `listbox`, never
 * `combobox`), without needing any change to the shared primitive itself.
 */
export async function selectSearchableOption(
  page: Page,
  label: string,
  query: string,
  optionName?: string,
): Promise<void> {
  const field = page.getByRole("combobox", { name: label });
  await field.click();
  await field.fill(query);
  if (optionName) {
    await page.getByRole("option", { name: optionName, exact: true }).click();
  } else {
    await page.getByRole("listbox").getByRole("option").first().click();
  }
}
