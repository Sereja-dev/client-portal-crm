import { Prisma } from "@/generated/prisma/client";
import {
  parseSearchParam,
  parsePageParam,
  parseEnumParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";
import { PROJECT_STATUSES } from "@/lib/validation/project";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";

export const PROJECT_SORT_FIELDS = ["name", "createdAt"] as const;
export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

export type ProjectListParams = {
  q: string;
  status?: (typeof PROJECT_STATUSES)[number];
  sortField: ProjectSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

export function parseProjectListParams(
  searchParams: RawSearchParams,
): ProjectListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseEnumParam(searchParams.status, PROJECT_STATUSES);
  const { field, dir, combined } = parseSortParam(
    searchParams.sort,
    PROJECT_SORT_FIELDS,
    "createdAt:desc",
  );
  const page = parsePageParam(searchParams.page);

  return { q, status, sortField: field, sortDir: dir, sortCombined: combined, page };
}

/**
 * Custom Statuses Phase 2A (Section C/D/H) — see leads/query.ts's own
 * identical comment on buildLeadWhere: the `status` filter is now
 * authoritative via `statusDefinitionId`, falling back to a null-
 * statusDefinitionId Project whose legacy `status` still matches (Section
 * D). The `?status=IN_PROGRESS`-shaped URL param itself is unchanged.
 */
export async function buildProjectWhere(
  organizationId: string,
  { q, status }: Pick<ProjectListParams, "q" | "status">,
): Promise<Prisma.ProjectWhereInput> {
  const statusFilter = status
    ? await (async (): Promise<Prisma.ProjectWhereInput> => {
        const definition = await resolveSystemStatusDefinition(organizationId, "PROJECT", status.toLowerCase());
        return definition
          ? { OR: [{ statusDefinitionId: definition.id }, { statusDefinitionId: null, status }] }
          : { status };
      })()
    : {};

  const searchFilter: Prisma.ProjectWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { client: { name: { contains: q, mode: "insensitive" as const } } },
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

export function buildProjectOrderBy(
  params: Pick<ProjectListParams, "sortField" | "sortDir">,
): Prisma.ProjectOrderByWithRelationInput {
  return { [params.sortField]: params.sortDir };
}
