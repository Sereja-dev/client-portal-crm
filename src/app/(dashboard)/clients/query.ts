import { Prisma } from "@/generated/prisma/client";
import {
  parseSearchParam,
  parsePageParam,
  parseStatusKeyParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";
import type { ClientStatusValue } from "@/lib/validation/client";
import { resolveStatusDefinitionByKey } from "@/lib/custom-statuses/resolution";
import { resolveTagAssignedEntityIds } from "@/lib/tags/list-query";

export const CLIENT_SORT_FIELDS = ["name", "createdAt"] as const;
export type ClientSortField = (typeof CLIENT_SORT_FIELDS)[number];

export type ClientListParams = {
  q: string;
  /** Custom Statuses Phase 2B (Section P) — a CustomStatusDefinition key (lower-case), not a fixed CLIENT_STATUSES enum value anymore; see parseStatusKeyParam's own comment for the legacy-URL compatibility this gives for free. */
  status?: string;
  /** Tags V2 (Section 5) — a Tag id, from `?tag=`. Any value that isn't a real UUID is treated as "no filter", same as an invalid status. */
  tagId?: string;
  sortField: ClientSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tags V2 (Section 5) — mirrors leads/query.ts's own local parseAssigneeParam pattern: an invalid/non-UUID value never widens or errors, it just falls back to "no filter." */
function parseTagIdParam(value: string | string[] | undefined): string | undefined {
  const raw = parseSearchParam(value);
  return raw && UUID_PATTERN.test(raw) ? raw : undefined;
}

export function parseClientListParams(
  searchParams: RawSearchParams,
): ClientListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseStatusKeyParam(searchParams.status);
  const tagId = parseTagIdParam(searchParams.tag);
  const { field, dir, combined } = parseSortParam(
    searchParams.sort,
    CLIENT_SORT_FIELDS,
    "createdAt:desc",
  );
  const page = parsePageParam(searchParams.page);

  return { q, status, tagId, sortField: field, sortDir: dir, sortCombined: combined, page };
}

/**
 * Custom Statuses Phase 2B (Section P) — the `status` filter is resolved
 * against ANY live CustomStatusDefinition (system or custom, active or
 * archived — resolveStatusDefinitionByKey) by key, replacing the fixed
 * CLIENT_STATUSES enum lookup Phase 2A used here. A SYSTEM match still
 * falls back to a null-statusDefinitionId Client whose legacy `status`
 * matches (Section D, unchanged); a CUSTOM match has no legacy
 * representation, so only `statusDefinitionId` is filtered. An unknown
 * key (never a real definition, or a typo) fails safe exactly like the
 * old fixed-enum `parseEnumParam` lookup always did: treated as no
 * filter at all, never an error and never a silently-empty result set.
 */
export async function buildClientWhere(
  organizationId: string,
  { q, status, tagId }: Pick<ClientListParams, "q" | "status" | "tagId">,
): Promise<Prisma.ClientWhereInput> {
  const statusFilter = status
    ? await (async (): Promise<Prisma.ClientWhereInput> => {
        // .toLowerCase() defensively re-applied here too (not only in
        // parseStatusKeyParam) — a direct caller of buildClientWhere
        // (bypassing the parser) must not have to know keys are stored
        // lower-case for its own filter to resolve correctly.
        const definition = await resolveStatusDefinitionByKey(organizationId, "CLIENT", status.toLowerCase());
        if (!definition) {
          return {};
        }
        return definition.isSystem
          ? {
              OR: [
                { statusDefinitionId: definition.id },
                { statusDefinitionId: null, status: definition.key.toUpperCase() as ClientStatusValue },
              ],
            }
          : { statusDefinitionId: definition.id };
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

  // Tags V2 (Section 5) — the required two-step query: resolve matching
  // entityIds from TagAssignment first (always organizationId+entityType
  // scoped — see resolveTagAssignedEntityIds' own comment), then fold
  // them into this `where` as a plain `id: { in: [...] }`. A tagId that
  // matches zero assignments (foreign-org, archived, or simply unused)
  // folds in as `id: { in: [] }`, which Prisma/Postgres always evaluates
  // to zero rows — an empty result, never "no filter" (Section 5: "do not
  // accidentally remove the tag filter and show all entities").
  const tagFilter: Prisma.ClientWhereInput = tagId
    ? { id: { in: await resolveTagAssignedEntityIds(organizationId, "CLIENT", tagId) } }
    : {};

  return {
    organizationId,
    // AND, not two separate top-level `OR` spreads — see leads/query.ts's
    // own buildLeadWhere for the full "why" (found by that module's own
    // pipeline-query.ts test suite; this file shares the identical bug
    // shape and the identical fix).
    AND: [statusFilter, searchFilter],
    ...tagFilter,
  };
}

export function buildClientOrderBy(
  params: Pick<ClientListParams, "sortField" | "sortDir">,
): Prisma.ClientOrderByWithRelationInput {
  return { [params.sortField]: params.sortDir };
}
