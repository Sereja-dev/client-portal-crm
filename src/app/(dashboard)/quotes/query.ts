import { Prisma } from "@/generated/prisma/client";
import {
  parseSearchParam,
  parsePageParam,
  parseEnumParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";
import { QUOTE_STATUSES } from "@/lib/validation/quote";

export const QUOTE_SORT_FIELDS = ["createdAt", "updatedAt", "issueDate", "validUntil", "total"] as const;
export type QuoteSortField = (typeof QUOTE_SORT_FIELDS)[number];

/**
 * The list page's own status FILTER offers two derived pseudo-values
 * (EXPIRED/CONVERTED) alongside the four real, stored QuoteStatus values
 * — deliberately a wider list than QUOTE_STATUSES itself (see that
 * constant's own header comment: it must stay exactly the four real enum
 * values, since it's also used to validate what a write path may
 * persist). This filter never writes anything; it only shapes a read
 * query, so widening it here is safe and never risks a stored row ending
 * up with an invalid status.
 */
export const QUOTE_STATUS_FILTER_VALUES = [...QUOTE_STATUSES, "EXPIRED", "CONVERTED"] as const;
export type QuoteStatusFilterValue = (typeof QUOTE_STATUS_FILTER_VALUES)[number];

export const QUOTE_TARGET_TYPE_VALUES = ["LEAD", "CLIENT"] as const;
export type QuoteTargetTypeValue = (typeof QUOTE_TARGET_TYPE_VALUES)[number];

export type QuoteListParams = {
  q: string;
  status?: QuoteStatusFilterValue;
  /**
   * CLIENT: clientId is set — this Quote's current, invoiceable target is
   * a real Client, whether it was created directly against one or reached
   * this state by a Lead converting later (Quote's own schema comment).
   * LEAD: clientId is null — still attached only to an unconverted Lead,
   * with no Client to invoice yet. This is "what can I act on today," not
   * "how did this Quote originate" — the list column/badge this filter
   * matches shows the same CURRENT-target distinction (see
   * buildQuoteTargetDisplay in page.tsx); the read-only single-Quote view
   * is the one place original Lead provenance is always shown regardless
   * of this filter (§G).
   */
  targetType?: QuoteTargetTypeValue;
  archived: boolean;
  sortField: QuoteSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

export function parseQuoteListParams(searchParams: RawSearchParams): QuoteListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseEnumParam(searchParams.status, QUOTE_STATUS_FILTER_VALUES);
  const targetType = parseEnumParam(searchParams.targetType, QUOTE_TARGET_TYPE_VALUES);
  const archived = parseSearchParam(searchParams.archived) === "1";
  const { field, dir, combined } = parseSortParam(searchParams.sort, QUOTE_SORT_FIELDS, "createdAt:desc");
  const page = parsePageParam(searchParams.page);

  return { q, status, targetType, archived, sortField: field, sortDir: dir, sortCombined: combined, page };
}

export function buildQuoteWhere(
  organizationId: string,
  { q, status, targetType, archived }: Pick<QuoteListParams, "q" | "status" | "targetType" | "archived">,
): Prisma.QuoteWhereInput {
  const statusFilter: Prisma.QuoteWhereInput =
    status === "EXPIRED"
      ? { status: "SENT", validUntil: { lt: new Date() } }
      : status === "CONVERTED"
        ? { convertedInvoiceId: { not: null } }
        : status
          ? { status }
          : {};

  return {
    organizationId,
    archivedAt: archived ? { not: null } : null,
    ...statusFilter,
    ...(targetType === "LEAD" ? { clientId: null } : {}),
    ...(targetType === "CLIENT" ? { clientId: { not: null } } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
            { client: { name: { contains: q, mode: "insensitive" as const } } },
            { lead: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

export function buildQuoteOrderBy(
  params: Pick<QuoteListParams, "sortField" | "sortDir">,
): Prisma.QuoteOrderByWithRelationInput {
  return { [params.sortField]: params.sortDir };
}
