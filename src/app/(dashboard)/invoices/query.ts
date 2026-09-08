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
