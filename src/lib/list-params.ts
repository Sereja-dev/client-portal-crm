export const PAGE_SIZE = 10;

export type SortDir = "asc" | "desc";

export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseSearchParam(value: string | string[] | undefined): string {
  return firstValue(value).trim();
}

export function parsePageParam(value: string | string[] | undefined): number {
  const n = Number(firstValue(value));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function parseEnumParam<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const v = firstValue(value);
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * Dashboard Redesign / Tasks overdue filter — a strict boolean-ish list
 * param: exactly the literal "true" is truthy; everything else (absent,
 * "false", "1", "yes", garbage) is falsy. Mirrors parseEnumParam's own
 * "one known-safe value or nothing" discipline — never a loose
 * truthy-string coercion.
 */
export function parseBooleanParam(value: string | string[] | undefined): boolean {
  return firstValue(value) === "true";
}

/**
 * Custom Statuses Phase 2B (Section P) — a `?status=`/`?stage=`-shaped
 * list filter param, no longer constrained to a fixed enum: lower-cased
 * so it can be resolved against a live CustomStatusDefinition's own key
 * (resolveStatusDefinitionByKey), which also transparently keeps a
 * legacy uppercase system value (`?status=ACTIVE`) working with zero
 * special-casing — see that function's own comment.
 */
export function parseStatusKeyParam(value: string | string[] | undefined): string | undefined {
  const v = firstValue(value).trim().toLowerCase();
  return v || undefined;
}

/**
 * Sort params are encoded as a single "field:direction" value (e.g.
 * "createdAt:desc") so the whole sort choice is one <select>, not two.
 */
export function parseSortParam<T extends string>(
  value: string | string[] | undefined,
  allowedFields: readonly T[],
  fallback: `${T}:${SortDir}`,
): { field: T; dir: SortDir; combined: string } {
  const raw = firstValue(value) || fallback;
  const [fieldRaw, dirRaw] = raw.split(":");
  const fallbackField = fallback.split(":")[0] as T;
  const field = (allowedFields as readonly string[]).includes(fieldRaw)
    ? (fieldRaw as T)
    : fallbackField;
  const dir: SortDir = dirRaw === "asc" ? "asc" : "desc";
  return { field, dir, combined: `${field}:${dir}` };
}

export function getOffset(page: number): number {
  return (page - 1) * PAGE_SIZE;
}

export function getTotalPages(total: number): number {
  return Math.max(Math.ceil(total / PAGE_SIZE), 1);
}

export type FilterOption = { value: string; label: string };

/**
 * Stale custom-status filter hardening — the shared, domain-neutral
 * twin of contracts/query.ts's own `buildContractEntityFilterOptions`
 * (that one is intentionally left untouched by this fix; see this
 * function's own call sites in clients/projects/leads page.tsx for the
 * "why a separate copy" reasoning — narrow, per-fix scope, not a
 * refactor of already-shipped Contract code).
 *
 * A `status`/`stage` filter `<select>` is rendered as a plain
 * uncontrolled native element. A syntactically-plausible but
 * unresolved custom-status KEY (never existed in this org, a typo, or
 * a foreign-org-looking string) already flows safely into the owning
 * domain's own now-fail-closed query builder (a deterministic
 * zero-match `where`, never a broadened one — see clients/query.ts's
 * own `buildClientWhere` for the paired fix this UI-side helper exists
 * to make truthful) and remains in the canonical URL — but with no
 * matching `<option>`, the browser's own native fallback would
 * silently select the FIRST option ("All statuses"/"All stages"),
 * hiding that a filter is still active. This function's only job is to
 * give that already-active, already-correctly-zero-match filter value
 * a real matching `<option>` to select, so the existing uncontrolled
 * select renders it truthfully instead of lying about it.
 *
 * Deliberately NOT a query change — `options` is exactly the same
 * already-loaded, already-built options array the caller's own
 * SearchFilterBar already renders (including any already-correctly-
 * appended "(archived)" entry for a real-but-archived definition — see
 * each page.tsx's own identical comment); no new lookup, no existence
 * probe, no widened scope. When `selectedValue` is undefined/empty, or
 * already matches one of `options` (a genuinely valid or archived
 * same-org definition), this returns `options` completely unchanged —
 * no sentinel, no new array identity beyond a defensive copy.
 *
 * The one new option's label is always the fixed, generic
 * `unavailableLabel` — never the raw key, never a guessed/looked-up
 * name. A foreign-org-looking key, a typo, and a key that never
 * existed at all are all indistinguishable through this label by
 * design — this function never queries anything outside the `options`
 * it was already given.
 */
export function buildFilterOptionsWithUnavailableValue(
  options: readonly FilterOption[],
  selectedValue: string | undefined,
  unavailableLabel: string,
): FilterOption[] {
  if (!selectedValue || options.some((option) => option.value === selectedValue)) {
    return [...options];
  }
  return [...options, { value: selectedValue, label: unavailableLabel }];
}
