/**
 * Time Tracking Phase 2A (Staff UI). Pure hours+minutes <-> durationMinutes
 * conversion — no framework/Prisma imports, safely importable from a
 * "use client" component and unit-testable directly. The stored model
 * stays a single integer (durationMinutes); this module exists purely
 * for the UI's own "Hours" + "Minutes" input pair (never decimal hours —
 * see the approved Phase 2A spec's own "DURATION UX" section).
 *
 * Deliberately does NOT enforce the 1..1440 total-minutes business rule
 * itself — src/lib/validation/time-entry.ts's own parseDurationMinutes
 * (Phase 1, unchanged) remains the single source of truth for that,
 * applied downstream once combineDurationInput hands off a combined
 * total. Duplicating that range check here would just be a second copy
 * of the same rule to keep in sync.
 */

export type CombineDurationInputResult = { ok: true; totalMinutes: number } | { ok: false };

/**
 * Combines raw "hours"/"minutes" form values into one total-minutes
 * integer. Rejects a negative or fractional hours/minutes value, and
 * rejects minutes outside 0..59 (a structural constraint on the *shape*
 * of the input, not the 1440 business ceiling — 90 minutes is simply
 * not a valid "minutes" component of an hours+minutes pair, regardless
 * of what the resulting total would be). Accepts a number or a numeric
 * string (the shape FormData.get() values arrive as).
 */
export function combineDurationInput(hours: unknown, minutes: unknown): CombineDurationInputResult {
  // Same guard as parseDurationMinutes' own (Phase 1, unchanged): only a
  // real number or string is ever coerced — `Number(null)` is 0 and
  // `Number([])` is also 0, both of which would otherwise silently
  // combine into a "valid" 0-minute duration instead of being rejected
  // as the malformed input they actually are.
  if ((typeof hours !== "number" && typeof hours !== "string") || (typeof minutes !== "number" && typeof minutes !== "string")) {
    return { ok: false };
  }

  const h = typeof hours === "number" ? hours : Number(hours);
  const m = typeof minutes === "number" ? minutes : Number(minutes);

  if (!Number.isFinite(h) || !Number.isInteger(h) || h < 0) {
    return { ok: false };
  }
  if (!Number.isFinite(m) || !Number.isInteger(m) || m < 0 || m > 59) {
    return { ok: false };
  }

  return { ok: true, totalMinutes: h * 60 + m };
}

/** Inverse of combineDurationInput — splits a stored total back into hours/minutes for pre-filling an edit form. */
export function splitDurationMinutes(totalMinutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/**
 * Human-readable duration for list/detail display — "30m", "1h", or
 * "1h 30m". Never renders the raw integer to users (see the approved
 * spec's own "LIST PAGE" section).
 */
export function formatDurationMinutes(totalMinutes: number): string {
  const { hours, minutes } = splitDurationMinutes(totalMinutes);
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}
