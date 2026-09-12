import { Prisma } from "@/generated/prisma/client";
import { LeadStage } from "@/generated/prisma/enums";
import {
  parseSearchParam,
  parsePageParam,
  parseStatusKeyParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";
import { resolveStatusDefinitionByKey } from "@/lib/custom-statuses/resolution";
import { resolveTagAssignedEntityIds } from "@/lib/tags/list-query";

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
  /** Custom Statuses Phase 2B (Section P) — a CustomStatusDefinition key (lower-case), not a fixed LeadStage enum value anymore; see ClientListParams's own identical comment (query.ts, clients/). */
  stage?: string;
  /** "unassigned" is a real, selectable filter value — distinct from "no filter" (undefined). Any other non-UUID-shaped value is treated as "no filter", same as an invalid stage. */
  assignedToUserId?: string;
  /** Tags V2 (Section 5) — a Tag id, from `?tag=`. Any value that isn't a real UUID is treated as "no filter", same as assignedToUserId's own non-UUID case. */
  tagId?: string;
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

/** Tags V2 (Section 5) — same non-UUID-falls-back-safely shape as parseAssigneeParam immediately above, minus the "unassigned" special case (a Tag filter has no equivalent concept). */
function parseTagIdParam(value: string | string[] | undefined): string | undefined {
  const raw = parseSearchParam(value);
  if (!raw) return undefined;
  return UUID_PATTERN.test(raw) ? raw : undefined;
}

export function parseLeadListParams(searchParams: RawSearchParams): LeadListParams {
  const q = parseSearchParam(searchParams.q);
  const stage = parseStatusKeyParam(searchParams.stage);
  const assignedToUserId = parseAssigneeParam(searchParams.assignedToUserId);
  const tagId = parseTagIdParam(searchParams.tag);
  const archived = parseSearchParam(searchParams.archived) === "1";
  const { field, dir, combined } = parseSortParam(searchParams.sort, LEAD_SORT_FIELDS, "createdAt:desc");
  const page = parsePageParam(searchParams.page);

  return { q, stage, assignedToUserId, tagId, archived, sortField: field, sortDir: dir, sortCombined: combined, page };
}

/**
 * organizationId is always the caller's own server-resolved value
 * (getCurrentUserOrganization()) — never read from params here or
 * anywhere in this module, so a crafted query string can never widen the
 * scope beyond the caller's own organization.
 *
 * Custom Statuses Phase 2B (Section P) — the `stage` filter is resolved
 * against ANY live CustomStatusDefinition (system or custom, active or
 * archived — resolveStatusDefinitionByKey) by key, replacing the fixed
 * LEAD_STAGE_VALUES enum lookup Phase 2A used here. A SYSTEM match still
 * falls back to a null-statusDefinitionId Lead whose legacy `stage`
 * matches (Section D, unchanged); a CUSTOM match has no legacy
 * representation, so only `statusDefinitionId` is filtered. The
 * `?stage=WON`-shaped legacy URL param keeps working for free — see
 * resolveStatusDefinitionByKey's own comment — and Pipeline's own
 * separate `stageView` URL param (view-params.ts) is untouched, staying
 * LeadStage-keyed (Section H/N). An unknown key fails safe exactly like
 * the old fixed-enum `parseEnumParam` lookup always did: no filter at
 * all, never an error and never a silently-empty result set (see this
 * module's own list-query.test.ts, item 8).
 */
export async function buildLeadWhere(
  organizationId: string,
  { q, stage, assignedToUserId, tagId, archived }: Pick<
    LeadListParams,
    "q" | "stage" | "assignedToUserId" | "tagId" | "archived"
  >,
): Promise<Prisma.LeadWhereInput> {
  const stageFilter = stage
    ? await (async (): Promise<Prisma.LeadWhereInput> => {
        // .toLowerCase() defensively re-applied here too — see
        // buildClientWhere's own identical comment.
        const definition = await resolveStatusDefinitionByKey(organizationId, "LEAD", stage.toLowerCase());
        if (!definition) {
          return {};
        }
        return definition.isSystem
          ? {
              OR: [
                { statusDefinitionId: definition.id },
                { statusDefinitionId: null, stage: definition.key.toUpperCase() as LeadStage },
              ],
            }
          : { statusDefinitionId: definition.id };
      })()
    : {};

  const searchFilter: Prisma.LeadWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { company: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  // Tags V2 (Section 5) — see clients/query.ts's own buildClientWhere
  // for the full "why" of this two-step fold-in.
  const tagFilter: Prisma.LeadWhereInput = tagId
    ? { id: { in: await resolveTagAssignedEntityIds(organizationId, "LEAD", tagId) } }
    : {};

  return {
    organizationId,
    archivedAt: archived ? { not: null } : null,
    // AND, not two separate top-level `OR` spreads — stageFilter and
    // searchFilter can each independently be `{ OR: [...] }`, and a
    // plain object spread of two `OR` keys would silently keep only the
    // last one, discarding the other's filter entirely (found by this
    // module's own pre-existing pipeline-query.ts test suite, which
    // shares this exact composition bug — see that file's own identical
    // fix comment). Nesting each in its own AND element keeps both
    // scoped and independently combined.
    AND: [stageFilter, searchFilter],
    ...(assignedToUserId === "unassigned"
      ? { assignedToUserId: null }
      : assignedToUserId
        ? { assignedToUserId }
        : {}),
    ...tagFilter,
  };
}

export function buildLeadOrderBy(
  params: Pick<LeadListParams, "sortField" | "sortDir">,
): Prisma.LeadOrderByWithRelationInput {
  return { [params.sortField]: params.sortDir };
}
