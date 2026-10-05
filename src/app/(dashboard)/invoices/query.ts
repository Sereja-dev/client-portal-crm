import { Prisma } from "@/generated/prisma/client";
import {
  parseSearchParam,
  parsePageParam,
  parseEnumParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";
import { INVOICE_STATUSES } from "@/lib/validation/invoice";

export const INVOICE_SORT_FIELDS = ["dueDate", "createdAt", "amount"] as const;
export type InvoiceSortField = (typeof INVOICE_SORT_FIELDS)[number];

export type InvoiceListParams = {
  q: string;
  status?: (typeof INVOICE_STATUSES)[number];
  sortField: InvoiceSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

export function parseInvoiceListParams(
  searchParams: RawSearchParams,
): InvoiceListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseEnumParam(searchParams.status, INVOICE_STATUSES);
  const { field, dir, combined } = parseSortParam(
    searchParams.sort,
    INVOICE_SORT_FIELDS,
    "createdAt:desc",
  );
  const page = parsePageParam(searchParams.page);

  return { q, status, sortField: field, sortDir: dir, sortCombined: combined, page };
}

export function buildInvoiceWhere(
  organizationId: string,
  { q, status }: Pick<InvoiceListParams, "q" | "status">,
): Prisma.InvoiceWhereInput {
  return {
    // organizationId (Invoice's own column, independent of Project) is
    // the sole tenant boundary — Quotes / Estimates Phase 2.3 (Invoice /
    // Project Coupling Audit) removed the `project: { organizationId }`
    // relation filter this used to also require: a project-less Invoice
    // has no Project relation to match, so that filter would have
    // silently excluded it from every single staff Invoice list.
    organizationId,
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { invoiceNumber: { contains: q, mode: "insensitive" as const } },
            { client: { name: { contains: q, mode: "insensitive" as const } } },
            { project: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

export function buildInvoiceOrderBy(
  params: Pick<InvoiceListParams, "sortField" | "sortDir">,
): Prisma.InvoiceOrderByWithRelationInput {
  return { [params.sortField]: params.sortDir };
}

// Tables Improvement Slice A — clickable sortable headers are a pure UI
// entry point onto the exact same already-reviewed sort pipeline above
// (INVOICE_SORT_FIELDS/parseSortParam/buildInvoiceOrderBy, completely
// unchanged by this slice) — see sortable-header.tsx's own header
// comment for why that primitive itself never constructs a field name
// or an `orderBy`.

/**
 * First-click default direction per field — matches the existing
 * Sort-by dropdown's own established option ordering exactly (SORT_OPTIONS
 * in page.tsx lists "Due date (soonest)" = dueDate:asc, "Newest first" =
 * createdAt:desc, and "Amount (high to low)" = amount:desc each before
 * their own reverse-direction sibling option) — reusing that existing UI
 * precedent rather than inventing a new convention.
 */
export const INVOICE_SORT_DEFAULT_DIRECTION: Record<InvoiceSortField, "asc" | "desc"> = {
  dueDate: "asc",
  createdAt: "desc",
  amount: "desc",
};

/**
 * Builds a `/invoices?...` href from a plain params object, omitting any
 * falsy value entirely rather than emitting an empty query param —
 * identical contract to buildTasksHref/buildLeadsHref. `page` is
 * deliberately never one of this function's own inputs for the sort/
 * chip call sites below — omitting it always resets pagination to page 1
 * (parsePageParam's own documented fallback), matching the required
 * "changing sort/filter resets to page 1" behavior with no special-cased
 * reset logic needed.
 */
export function buildInvoicesHref(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/invoices?${qs}` : "/invoices";
}

/**
 * Clicking a sortable header: the same field toggles asc<->desc; a
 * different field always starts at ITS OWN established default
 * direction (INVOICE_SORT_DEFAULT_DIRECTION above) — never a surprising
 * tri-state cycle.
 */
export function nextInvoiceSortCombined(
  current: Pick<InvoiceListParams, "sortField" | "sortDir">,
  field: InvoiceSortField,
): string {
  if (field !== current.sortField) {
    return `${field}:${INVOICE_SORT_DEFAULT_DIRECTION[field]}`;
  }
  return `${field}:${current.sortDir === "asc" ? "desc" : "asc"}`;
}

/**
 * Invoice quick-filter chips (locked spec §1.3/§16) — exactly four,
 * each a shortcut for the EXISTING singular `?status=` filter, never a
 * new/hidden/reinterpreted status concept. "Overdue" here means exactly
 * the persisted `OVERDUE` InvoiceStatus value — NOT the Finance KPI's
 * own separate "operationally overdue" calculation (a different,
 * unrelated derived concept this slice does not touch). CANCELLED is
 * deliberately absent — it stays Status-dropdown-only, per the locked
 * spec.
 */
export const INVOICE_QUICK_FILTERS: readonly { label: string; status: (typeof INVOICE_STATUSES)[number] }[] = [
  { label: "Draft", status: "DRAFT" },
  { label: "Sent", status: "SENT" },
  { label: "Overdue", status: "OVERDUE" },
  { label: "Paid", status: "PAID" },
];
