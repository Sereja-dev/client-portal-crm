import { Prisma } from "@/generated/prisma/client";
import {
  parseSearchParam,
  parsePageParam,
  parseStatusKeyParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";
import type { ProjectStatusValue } from "@/lib/validation/project";
import { resolveStatusDefinitionByKey } from "@/lib/custom-statuses/resolution";

export const PROJECT_SORT_FIELDS = ["name", "createdAt"] as const;
export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

export type ProjectListParams = {
  q: string;
  /** Custom Statuses Phase 2B (Section P) — see ClientListParams's own identical comment. */
  status?: string;
  sortField: ProjectSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

export function parseProjectListParams(
  searchParams: RawSearchParams,
): ProjectListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseStatusKeyParam(searchParams.status);
  const { field, dir, combined } = parseSortParam(
    searchParams.sort,
    PROJECT_SORT_FIELDS,
    "createdAt:desc",
  );
  const page = parsePageParam(searchParams.page);

  return { q, status, sortField: field, sortDir: dir, sortCombined: combined, page };
}

/**
 * Custom Statuses Phase 2B (Section P) — see buildClientWhere's own
 * identical comment; the `?status=IN_PROGRESS`-shaped legacy URL keeps
 * working for free via resolveStatusDefinitionByKey's own lower-case-key
 * matching.
 */
export async function buildProjectWhere(
  organizationId: string,
  { q, status }: Pick<ProjectListParams, "q" | "status">,
): Promise<Prisma.ProjectWhereInput> {
  const statusFilter = status
    ? await (async (): Promise<Prisma.ProjectWhereInput> => {
        // .toLowerCase() defensively re-applied here too — see
        // buildClientWhere's own identical comment.
        const definition = await resolveStatusDefinitionByKey(organizationId, "PROJECT", status.toLowerCase());
        if (!definition) {
          return {};
        }
        return definition.isSystem
          ? {
              OR: [
                { statusDefinitionId: definition.id },
                { statusDefinitionId: null, status: definition.key.toUpperCase() as ProjectStatusValue },
              ],
            }
          : { statusDefinitionId: definition.id };
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
