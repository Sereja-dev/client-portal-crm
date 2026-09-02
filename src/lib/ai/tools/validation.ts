/**
 * AI Assistant Batch 1B.1 — shared input-validation primitives every
 * domain tool's own validator composes from. Every tool treats its own
 * arguments as fully untrusted `unknown` at runtime: no orchestrator
 * exists yet to guarantee a model's JSON tool-call output actually
 * matches a TypeScript type (and even once one does, a model's own
 * output can never be trusted to match one) — these helpers are the one
 * closed, shared set of checks, so "reject an unknown key" behaves
 * identically across every tool rather than being reinvented per file.
 *
 * Deliberately narrower than src/lib/search/normalize-query.ts's own
 * normalizeSearchQuery(): Search silently truncates an oversized query
 * (a live, debounced search box a user never consciously submits) — a
 * model-constructed tool call is different, closer to a form submission,
 * so an oversized query here is rejected outright as invalid_input
 * rather than silently mangled (see result.ts's own doc comment on the
 * three error categories).
 */

export const AI_TOOL_QUERY_MAX_LENGTH = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True only if every one of `value`'s own keys is in `allowedKeys` — an
 * unknown extra key (organizationId, userId, limit, where, select, or
 * anything else outside this one tool's own named schema) fails
 * validation rather than being silently dropped, so a model probing for
 * a forbidden capability gets a uniform "invalid_input" rather than ever
 * learning which keys are quietly ignored versus rejected outright.
 */
export function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function isValidOptionalQuery(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  return typeof value === "string" && value.length <= AI_TOOL_QUERY_MAX_LENGTH;
}

export function isValidEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function isValidOptionalEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T | undefined {
  if (value === undefined) return true;
  return isValidEnum(value, allowed);
}

/** The strict, most-common UUID convention already used throughout this codebase (e.g. organizations/[id]/actions.ts, invoices/pdf/storage.ts) — not the looser variant activity/query.ts's own cursor decoder uses. */
export function isValidRef(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidOptionalRef(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  return isValidRef(value);
}

export function isValidOptionalIsoDate(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}
