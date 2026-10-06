import { parseSearchParam, parseEnumParam, parseSortParam, type RawSearchParams } from "@/lib/list-params";
import { isUuid } from "@/lib/validation/lead";
import { Prisma } from "@/generated/prisma/client";
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
  // Contract client-filter UUID fix — format-validated at parse time
  // (isUuid), same guard projectId below already has: `id` is `@db.Uuid`
  // on Client, so an unguarded non-UUID string reaching listContracts()'s
  // own Prisma `where` throws a raw PrismaClientKnownRequestError
  // (confirmed directly during Documents Slice A — this was a genuine
  // pre-existing gap, reported separately from that slice and fixed here
  // on its own). A malformed value here simply falls back to "no client
  // filter" (undefined), never an error — a foreign-but-well-formed org's
  // own real Client id still safely matches zero rows via
  // listContracts()'s own organizationId scoping, which is a correctness
  // property, not a format-validation concern this parser needs to own —
  // identical reasoning to projectId's own.
  clientId?: string;
  // Documents Slice A — format-validated at parse time (isUuid), mirroring
  // tasks/query.ts's own identical ?projectId= guard exactly: `id` is
  // `@db.Uuid` on Project, so an unguarded non-UUID string reaching
  // listContracts()'s own Prisma `where` throws a raw
  // PrismaClientKnownRequestError. A malformed value here simply falls
  // back to "no project filter" (undefined), never an error — a
  // foreign-but-well-formed org's own real Project id still safely
  // matches zero rows via listContracts()'s own organizationId scoping
  // (see that function's own ListContractsOptions.projectId comment),
  // which is a correctness property, not a format-validation concern
  // this parser needs to own.
  projectId?: string;
  archived: boolean;
  sortField: ContractSortField;
  sortDir: "asc" | "desc";
  // "" when no ?sort= was present at all — deliberately NOT the parsed
  // fallback value. This is how buildContractOrderBy below tells "no
  // sort chosen yet" apart from "the chosen value happens to equal a
  // field's own default direction," which is required to satisfy the
  // locked "default no-sort behavior remains exactly the current
  // existing fixed order" requirement: the pre-existing default order
  // (createdAt desc) is NOT expressible as a `field:dir` pair from
  // CONTRACT_SORT_FIELDS (createdAt itself is deliberately not a
  // sortable field — see that const's own doc comment), so "absent"
  // must be tracked as its own distinct state, never conflated with any
  // allowlisted field's own default.
  sortCombined: string;
  hasSort: boolean;
};

// Tables Improvement Slice B — a small, explicit, persisted-field-only
// allowlist (locked spec §6/§7), reusing list-params.ts's own generic
// parseSortParam exactly as Invoice's Slice A pilot already does (see
// invoices/query.ts's own INVOICE_SORT_FIELDS). Deliberately just
// `issueDate`: it is the only one of the four candidate date fields
// (issueDate/effectiveDate/expiresAt/createdAt) actually rendered as its
// own visible column in the current table (page.tsx's "Issue date"
// column) — per the locked spec's own explicit "if one of the preferred
// fields is not displayed in the list, do not make it sortable just for
// symmetry," effectiveDate/expiresAt/createdAt are excluded. createdAt
// itself is NOT added here merely to represent the pre-existing default
// order either — that would make the "default order" selectable from
// the Sort-by dropdown as a *field*, which is a bigger product surface
// than this slice approved; "no sort" is represented as its own distinct
// `sortCombined === ""` state instead (see ContractListParams' own doc
// comment above and buildContractOrderBy below).
export const CONTRACT_SORT_FIELDS = ["issueDate"] as const;
export type ContractSortField = (typeof CONTRACT_SORT_FIELDS)[number];

// Suggested first-click defaults (locked spec §9): issueDate -> asc
// ("earlier first" operational date reading). Only the one allowlisted
// field has an entry — see CONTRACT_SORT_FIELDS' own doc comment on why
// effectiveDate/expiresAt/createdAt are excluded from sorting entirely
// in this slice.
export const CONTRACT_SORT_DEFAULT_DIRECTION: Record<ContractSortField, "asc" | "desc"> = {
  issueDate: "asc",
};

export function parseContractListParams(searchParams: RawSearchParams): ContractListParams {
  const q = parseSearchParam(searchParams.q);
  const status = parseEnumParam(searchParams.status, CONTRACT_STATUS_FILTER_VALUES);
  const clientIdRaw = parseSearchParam(searchParams.client);
  const projectIdRaw = parseSearchParam(searchParams.project);
  const archived = parseSearchParam(searchParams.archived) === "1";
  const hasSort = parseSearchParam(searchParams.sort) !== "";
  const { field: sortField, dir: sortDir, combined } = parseSortParam(
    searchParams.sort,
    CONTRACT_SORT_FIELDS,
    `issueDate:${CONTRACT_SORT_DEFAULT_DIRECTION.issueDate}`,
  );

  return {
    q,
    status,
    clientId: isUuid(clientIdRaw) ? clientIdRaw : undefined,
    projectId: isUuid(projectIdRaw) ? projectIdRaw : undefined,
    archived,
    sortField,
    sortDir,
    sortCombined: hasSort ? combined : "",
    hasSort,
  };
}

/**
 * Deterministic order, preserving the EXACT pre-existing default
 * (`[{createdAt:"desc"},{id:"desc"}]`, byte-identical to
 * listContracts()'s own current hardcoded orderBy) whenever no `?sort=`
 * param is present at all — clickable headers/the Sort-by dropdown are
 * opt-in through URL state, never a silent baseline-ordering change
 * (locked spec §8). Once a sort IS chosen, orders by that one
 * allowlisted field with `id` as the same stable tie-break direction
 * listContracts() itself already uses for its own default, never a
 * second/different tie-break convention.
 */
export function buildContractOrderBy(
  listParams: Pick<ContractListParams, "hasSort" | "sortField" | "sortDir">,
): Prisma.ContractOrderByWithRelationInput[] {
  if (!listParams.hasSort) {
    return [{ createdAt: "desc" }, { id: "desc" }];
  }
  return [{ [listParams.sortField]: listParams.sortDir }, { id: listParams.sortDir }];
}

/**
 * The one shared base every quick-filter chip and the sortable header
 * builds its own href from — mirrors buildInvoicesHref's own exact
 * shape (invoices/query.ts), just with Contract's own param set
 * (q/status/client/project/archived/sort). Falsy values are omitted
 * entirely, never an empty query-string value — this is also how
 * `sort=""` (the "no sort chosen" state) correctly disappears from the
 * URL rather than appearing as a literal empty `sort=` param.
 */
export function buildContractsHref(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/contracts?${qs}` : "/contracts";
}

/**
 * Clicking the currently-active sortable field toggles asc/desc;
 * clicking any other allowlisted field (or clicking from the "no sort"
 * state) jumps straight to that field's own established default
 * direction — identical toggle semantics to Invoice's own
 * nextInvoiceSortCombined, generalized with an explicit `hasSort` guard
 * since (unlike Invoice) Contracts has a genuine "no sort active" state
 * distinct from any allowlisted field's own default.
 */
export function nextContractSortCombined(
  current: Pick<ContractListParams, "sortField" | "sortDir" | "hasSort">,
  field: ContractSortField,
): string {
  if (!current.hasSort || field !== current.sortField) {
    return `${field}:${CONTRACT_SORT_DEFAULT_DIRECTION[field]}`;
  }
  return `${field}:${current.sortDir === "asc" ? "desc" : "asc"}`;
}

// Tables Improvement Slice B — exactly the three approved quick-filter
// chips (locked spec §11), mapping directly to persisted ContractStatus
// values only. Terminated stays Status-dropdown-only; EXPIRED is never
// a chip (and never a filter value at all — see CONTRACT_STATUS_FILTER_VALUES'
// own doc comment above).
export const CONTRACT_QUICK_FILTERS: readonly { label: string; status: ContractStatus }[] = [
  { label: "Draft", status: "DRAFT" },
  { label: "Sent", status: "SENT" },
  { label: "Accepted", status: "ACCEPTED" },
];
