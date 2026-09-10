import { Prisma } from "@/generated/prisma/client";
import {
  parseSearchParam,
  parsePageParam,
  parseEnumParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";
import { CLIENT_STATUSES } from "@/lib/validation/client";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";

export const CLIENT_SORT_FIELDS = ["name", "createdAt"] as const;
export type ClientSortField = (typeof CLIENT_SORT_FIELDS)[number];

export type ClientListParams = {
  q: string;
  status?: (typeof CLIENT_STATUSES)[number];
  sortField: ClientSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

export function parseClientListParams(
  searchParams: RawSearchParams,
): ClientListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseEnumParam(searchParams.status, CLIENT_STATUSES);
  const { field, dir, combined } = parseSortParam(
    searchParams.sort,
    CLIENT_SORT_FIELDS,
    "createdAt:desc",
  );
  const page = parsePageParam(searchParams.page);

  return { q, status, sortField: field, sortDir: dir, sortCombined: combined, page };
}

/**
 * Custom Statuses Phase 2A (Section C/D/H) — see leads/query.ts's own
 * identical comment on buildLeadWhere: the `status` filter is now
 * authoritative via `statusDefinitionId`, falling back to a null-
 * statusDefinitionId Client whose legacy `status` still matches (Section
 * D). The `?status=ACTIVE`-shaped URL param itself is unchanged.
 */
export async function buildClientWhere(
  organizationId: string,
  { q, status }: Pick<ClientListParams, "q" | "status">,
): Promise<Prisma.ClientWhereInput> {
  const statusFilter = status
    ? await (async (): Promise<Prisma.ClientWhereInput> => {
        const definition = await resolveSystemStatusDefinition(organizationId, "CLIENT", status.toLowerCase());
        return definition
          ? { OR: [{ statusDefinitionId: definition.id }, { statusDefinitionId: null, status }] }
          : { status };
      })()
    : {};

  const searchFilter: Prisma.ClientWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { company: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  return {
    organizationId,
    // AND, not two separate top-level `OR` spreads — see leads/query.ts's
    // own buildLeadWhere for the full "why" (found by that module's own
    // pipeline-query.ts test suite; this file shares the identical bug
    // shape and the identical fix).
    AND: [statusFilter, searchFilter],
  };
}

export function buildClientOrderBy(
  params: Pick<ClientListParams, "sortField" | "sortDir">,
): Prisma.ClientOrderByWithRelationInput {
  return { [params.sortField]: params.sortDir };
}
