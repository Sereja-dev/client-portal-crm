import type { SearchableSelectOption } from "@/components/ui/searchable-select";

/**
 * Forms Improvement Slice A1 §8 — the one locked, Product-owned priority
 * group, in the exact order Product specified. Deliberately NOT derived
 * from user location, browser locale, organization country, IP, or
 * timezone (the slice brief's own explicit prohibition) — a plain,
 * reviewable constant is the whole point: anyone can see the exact order
 * without running anything.
 */
export const POPULAR_CURRENCY_CODES: readonly string[] = ["USD", "EUR", "GBP", "AED", "CAD", "AUD"];

/**
 * Orders an already-canonical supported-currency list (Invoice's own
 * narrower two-decimal set, or Company Settings' own broader
 * `Intl.supportedValuesOf("currency")` set — this function deliberately
 * takes the list as a parameter rather than owning one itself, so it
 * never becomes a second, independent currency catalog; see this
 * module's own call sites for which source each surface already uses)
 * into: the locked popular group first (only the codes that are actually
 * present in `supportedCurrencies`, in Product's exact order, each
 * appearing at most once), then every remaining supported currency in
 * its existing stable order. Never drops, adds, or renames a currency —
 * a pure reordering of exactly the same set the caller passed in.
 *
 * Labels are the bare currency code, matching this app's own existing,
 * unchanged convention — every current `<option>` across Invoice/
 * Recurring Invoice/Quote/Company Settings already renders just the
 * code, never a code-plus-display-name pair, so there is no existing
 * "code + name" convention for this slice to preserve beyond the code
 * itself. (Deliberately not introducing a new Intl.DisplayNames-based
 * name lookup here either — that would be new scope beyond this slice's
 * own locked brief, and a fresh source of locale-sensitive label text to
 * reason about for no requested benefit.)
 */
export function buildOrderedCurrencyOptions(supportedCurrencies: readonly string[]): SearchableSelectOption[] {
  const supportedSet = new Set(supportedCurrencies);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const code of POPULAR_CURRENCY_CODES) {
    if (supportedSet.has(code) && !seen.has(code)) {
      ordered.push(code);
      seen.add(code);
    }
  }

  for (const code of supportedCurrencies) {
    if (!seen.has(code)) {
      ordered.push(code);
      seen.add(code);
    }
  }

  return ordered.map((code) => ({ value: code, label: code }));
}
