import type { SearchableSelectOption } from "@/components/ui/searchable-select";

/**
 * Forms Improvement Slice A2.1 — Invoice-local pure mapping helpers for
 * the Client/Project SearchableSelect adoption. Deliberately NOT a
 * cross-surface wrapper component the way CurrencySelect is (A1) —
 * Recurring Invoice and Quote are explicitly out of scope for this pilot
 * (locked A2 audit conclusion), so this stays scoped to Invoice only
 * rather than inventing a shared `ClientSelect`/`ProjectSelect`
 * component ahead of a Product decision to roll either out further.
 *
 * Both functions are pure reorderings/mappings of exactly the data the
 * page already fetches — no new fields, no status/archived filtering, no
 * server query change. Kept separate from invoice-form.tsx itself (rather
 * than inline, unexported functions) purely so they're independently
 * unit-testable without rendering the whole form — mirroring the same
 * reasoning src/lib/invoices/currency-select-options.ts's own header
 * comment gives for buildOrderedCurrencyOptions.
 */

/** `{id, name}` -> `{value, label}`, in the exact order the caller already fetched/sorted them. */
export function toClientOptions(clients: readonly { id: string; name: string }[]): SearchableSelectOption[] {
  return clients.map((client) => ({ value: client.id, label: client.name }));
}

/**
 * "No project" is a real, always-explicitly-selectable business value —
 * not a placeholder, not "nothing chosen yet" — matching the exact
 * `<option value="">No project</option>` this replaces. Always first,
 * even when the caller's own project list for the current Client is
 * empty, so the field never silently loses this option.
 */
export const NO_PROJECT_OPTION: SearchableSelectOption = { value: "", label: "No project" };

/** `{id, label, clientId}` (already client-side filtered by the caller) -> `{value, label}`, "No project" first. */
export function toProjectOptions(
  projectsForClient: readonly { id: string; label: string }[],
): SearchableSelectOption[] {
  return [NO_PROJECT_OPTION, ...projectsForClient.map((project) => ({ value: project.id, label: project.label }))];
}
