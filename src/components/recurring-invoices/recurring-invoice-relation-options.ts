import type { SearchableSelectOption } from "@/components/ui/searchable-select";

/**
 * Forms Improvement Slice A2.2 — Recurring-Invoice-local pure mapping
 * helpers for the Client/Project SearchableSelect adoption. Deliberately
 * a SEPARATE, independent file from src/components/invoices/
 * invoice-relation-options.ts (A2.1), not a cross-import of it: that
 * file's own header comment explicitly commits to staying Invoice-scoped
 * ("Recurring Invoice and Quote are explicitly out of scope for this
 * pilot"), and importing it from here would either leave that comment
 * stale/misleading or require editing the already-closed A2.1 slice —
 * both of which this slice's own brief explicitly rules out ("do NOT
 * automatically move/refactor it into shared code just for
 * deduplication... No broad cleanup"). The actual logic is a handful of
 * tiny, genuinely trivial pure mappings; duplicating it here is clearer
 * and safer than coupling two independent forms' relational selectors
 * through one shared module ahead of any Product decision to do so.
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
