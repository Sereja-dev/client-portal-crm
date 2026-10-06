import type { InvoiceListParams } from "./query";

export const INVOICE_SAVED_VIEW_SURFACE = "invoices" as const;

/**
 * Tables Improvement Slice D1 — the exact, explicit allowlist of
 * canonical Invoice list params a Saved View may persist (locked spec
 * §10): `q`, `status`, `sort`. Deliberately excludes `page` (locked spec
 * §12) and anything not already an existing canonical URL param.
 *
 * Kept in its own tiny pure module rather than added to ./query.ts on
 * purpose: ./query.ts also imports `Prisma` (for `buildInvoiceOrderBy`'s
 * own return type) and is otherwise exclusively consumed by the Server
 * Component page. `buildInvoiceHrefFromSavedViewParams` below needs to
 * run on the CLIENT (it builds the "Apply" link's href inside
 * SavedViewsControl) — importing ./query.ts there would risk pulling the
 * generated Prisma client into the browser bundle (locked spec §3's own
 * "do not force a server-only import across the Client boundary").
 * `import type` above is erased entirely at build time, so referencing
 * `InvoiceListParams` as a type only is safe either side of that
 * boundary.
 */
const ALLOWED_KEYS = ["q", "status", "sort"] as const;

/**
 * Builds the allowlisted, serializable params object a Saved View
 * stores — straight from the already-parsed canonical InvoiceListParams
 * the page itself resolved (never from a re-parsed/raw query string;
 * locked spec §11). An absent/empty value is omitted entirely, mirroring
 * buildInvoicesHref's own "falsy -> omitted" contract.
 */
export function serializeInvoiceSavedViewParams(
  listParams: Pick<InvoiceListParams, "q" | "status" | "sortCombined">,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (listParams.q) params.q = listParams.q;
  if (listParams.status) params.status = listParams.status;
  if (listParams.sortCombined) params.sort = listParams.sortCombined;
  return params;
}

/**
 * Builds the `/invoices?...` href to navigate to when a saved view is
 * applied. Only ever reads the fixed ALLOWED_KEYS above — any other key
 * present in a stored view's own `params` (e.g. a hand-edited
 * localStorage value, or a future surface version) is silently ignored,
 * never replayed into the URL (locked spec §9). This never merges with
 * the current page's own URL state — the returned href is built fresh
 * from `params` alone, so applying a view always REPLACES managed view
 * state (locked spec §19). The resulting URL is not trusted as
 * validated; it re-enters `parseInvoiceListParams` on the next page load
 * exactly like any other navigation (locked spec §15) — in particular,
 * omitting `page` here always lands on page 1 (locked spec §12).
 */
export function buildInvoiceHrefFromSavedViewParams(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const key of ALLOWED_KEYS) {
    const value = params[key];
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/invoices?${qs}` : "/invoices";
}
