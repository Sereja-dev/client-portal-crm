import { parseSearchParam, parseEnumParam, type RawSearchParams } from "@/lib/list-params";
import { isUuid } from "@/lib/validation/lead";
import type { ContractStatus } from "@/generated/prisma/enums";

// Mirrors QUOTE_STATUSES's own exact precedent (src/lib/validation/quote.ts)
// — a plain literal tuple of the four real, stored values, not derived
// from the generated Prisma enum object.
const CONTRACT_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "TERMINATED"] as const;

/**
 * Contracts Phase 2 (Staff UI) — list-page params only. Deliberately
 * thin: src/lib/contracts/queries.ts's own listContracts() already takes
 * a small, structured options object ({includeArchived, status,
 * clientId, search}) rather than a raw Prisma `where` — unlike Quote/
 * Invoice's own query.ts (which builds Prisma.*WhereInput directly,
 * since their own domain layer has no equivalent options-object query
 * function) there is nothing to translate here; this module only parses
 * ?q=/?status=/?client=/?archived= into that same options shape,
 * verbatim.
 *
 * Locked choice (§5, documented as required): the status FILTER exposes
 * only the four real, stored ContractStatus values — never ACTIVE or
 * EXPIRED. Both are derived-only (src/lib/contracts/status.ts) and,
 * unlike Quote's own EXPIRED filter (a single `validUntil < now()`
 * boundary check), Contract's ACTIVE requires a compound condition
 * (status=ACCEPTED AND (effectiveDate IS NULL OR effectiveDate <= now())
 * AND (expiresAt IS NULL OR expiresAt >= now())) that Invoice's own
 * closest analog (a derived OVERDUE concept) also declines to expose as
 * a list filter value for its own status dropdown. Wiring either in
 * would mean either (a) hand-building a second, list-only derived-status
 * predicate alongside the one already-reviewed getContractDisplayStatus()
 * pure function — a real risk of the two silently drifting apart over
 * time — or (b) fetching every ACCEPTED row and filtering in application
 * code, which breaks this list's own simple, fully-DB-side count/query
 * shape for no real V1 benefit at this phase's expected scale. Deferred;
 * Active/Archived (archivedAt) below is a completely different, already
 * simple boolean and is fully supported.
 */
export const CONTRACT_STATUS_FILTER_VALUES = CONTRACT_STATUSES;

export type ContractListParams = {
  q: string;
  status?: ContractStatus;
  clientId?: string;
  // Documents Slice A — format-validated at parse time (isUuid), mirroring
  // tasks/query.ts's own identical ?projectId= guard exactly: `id` is
  // `@db.Uuid` on Project, so an unguarded non-UUID string reaching
  // listContracts()'s own Prisma `where` throws a raw
  // PrismaClientKnownRequestError (confirmed directly — the clientId
  // filter immediately above has this same unguarded gap today, a
  // pre-existing condition reported separately rather than silently
  // fixed here; this new projectId option is written defensively from
  // the start instead of replicating that gap). A malformed value here
  // simply falls back to "no project filter" (undefined), never an
  // error — a foreign-but-well-formed org's own real Project id still
  // safely matches zero rows via listContracts()'s own organizationId
  // scoping (see that function's own ListContractsOptions.projectId
  // comment), which is a correctness property, not a format-validation
  // concern this parser needs to own.
  projectId?: string;
  archived: boolean;
};

export function parseContractListParams(searchParams: RawSearchParams): ContractListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseEnumParam(searchParams.status, CONTRACT_STATUS_FILTER_VALUES);
  const clientIdRaw = parseSearchParam(searchParams.client);
  const projectIdRaw = parseSearchParam(searchParams.project);
  const archived = parseSearchParam(searchParams.archived) === "1";

  return {
    q,
    status,
    clientId: clientIdRaw || undefined,
    projectId: isUuid(projectIdRaw) ? projectIdRaw : undefined,
    archived,
  };
}
