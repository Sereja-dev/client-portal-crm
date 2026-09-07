import { Prisma } from "@/generated/prisma/client";
import { LeadStage } from "@/generated/prisma/enums";
import {
  parseSearchParam,
  parsePageParam,
  parseEnumParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";

/**
 * Leads / Sales Pipeline Phase 3. Mirrors src/app/(dashboard)/clients/
 * query.ts's own exact conventions — same parse/build split, same
 * list-params helpers, same "organizationId is a function parameter,
 * never read from searchParams" discipline (an attacker-supplied
 * organizationId query param is simply never looked at).
 */

export const LEAD_STAGE_VALUES = Object.values(LeadStage);

export const LEAD_SORT_FIELDS = ["createdAt", "name", "value"] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];

export type LeadListParams = {
  q: string;
  stage?: LeadStage;
  /** "unassigned" is a real, selectable filter value — distinct from "no filter" (undefined). Any other non-UUID-shaped value is treated as "no filter", same as an invalid stage. */
  assignedToUserId?: string;
  archived: boolean;
  sortField: LeadSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAssigneeParam(value: string | string[] | undefined): string | undefined {
  const raw = parseSearchParam(value);
  if (!raw) return undefined;
  if (raw === "unassigned") return raw;
  // Any value that isn't a real UUID (or "unassigned") is treated as "no
  // filter" rather than passed through to the where clause — an invalid
  // or foreign id can never narrow/leak results, it just falls back
  // safely to "show everything the caller's own organization already
  // scopes."
  return UUID_PATTERN.test(raw) ? raw : undefined;
}

export function parseLeadListParams(searchParams: RawSearchParams): LeadListParams {
  const q = parseSearchParam(searchParams.q);
  const stage = parseEnumParam(searchParams.stage, LEAD_STAGE_VALUES);
  const assignedToUserId = parseAssigneeParam(searchParams.assignedToUserId);
  const archived = parseSearchParam(searchParams.archived) === "1";
  const { field, dir, combined } = parseSortParam(searchParams.sort, LEAD_SORT_FIELDS, "createdAt:desc");
  const page = parsePageParam(searchParams.page);

  return { q, stage, assignedToUserId, archived, sortField: field, sortDir: dir, sortCombined: combined, page };
}

/**
 * organizationId is always the caller's own server-resolved value
 * (getCurrentUserOrganization()) — never read from params here or
 * anywhere in this module, so a crafted query string can never widen the
 * scope beyond the caller's own organization.
 */
export function buildLeadWhere(
  organizationId: string,
  { q, stage, assignedToUserId, archived }: Pick<LeadListParams, "q" | "stage" | "assignedToUserId" | "archived">,
): Prisma.LeadWhereInput {
  return {
    organizationId,
    archivedAt: archived ? { not: null } : null,
    ...(stage ? { stage } : {}),
    ...(assignedToUserId === "unassigned"
      ? { assignedToUserId: null }
      : assignedToUserId
        ? { assignedToUserId }
        : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { company: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

export function buildLeadOrderBy(
  params: Pick<LeadListParams, "sortField" | "sortDir">,
): Prisma.LeadOrderByWithRelationInput {
  return { [params.sortField]: params.sortDir };
}
