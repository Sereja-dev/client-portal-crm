/**
 * AI Assistant — authoritative temporal grounding.
 *
 * Deliberately pure: no `Date.now()`/`new Date()`, no Prisma, no
 * `server-only` import — `now` and `timezone` are always explicit inputs,
 * resolved by the caller (src/lib/ai/orchestrate.ts for product,
 * scripts/ai-provider-eval/loop.ts for the benchmark). This is what lets
 * both product and the isolated benchmark package import this exact same
 * module directly, and lets tests inject a fixed `now` with zero
 * wall-clock dependence (see test/unit/ai/temporal-context.test.ts).
 *
 * The static, narrative AI_ASSISTANT_SYSTEM_PROMPT (system-prompt.ts) is
 * never modified or interpolated by this module — `buildEffectiveSystemPrompt()`
 * only ever appends a short, separate, server-authored suffix to whatever
 * `basePrompt` string its caller passes in. Both call sites pass the
 * unmodified `getAiAssistantSystemPrompt()` value as `basePrompt`.
 *
 * `now`/`timezone` here are never derived from a user prompt, a tool
 * result, or any client-supplied value — see orchestrate.ts's own
 * doc comment on this function's product call site, and README.md's own
 * "Live protocol canary"/benchmark sections for the fixed benchmark
 * anchor this same function is fed in scripts/ai-provider-eval/loop.ts.
 */

/** Formats `instant`'s own calendar date in `timeZone` as "YYYY-MM-DD" — via Intl.DateTimeFormat's own formatted parts (same technique src/lib/calendar-events/timezone.ts's formatWallClock() uses), never a locale-format string that could vary by ICU version/locale. */
function formatIsoDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type TemporalContextInput = {
  /** The unmodified, existing static narrative prompt (getAiAssistantSystemPrompt()) — never edited by this function. */
  basePrompt: string;
  /** The authoritative current instant — real wall-clock time in product, the fixed ANCHOR_NOW in the benchmark. Never computed inside this function. */
  now: Date;
  /** An already-resolved IANA time zone name (e.g. "America/New_York", "UTC") — never resolved inside this function. */
  timezone: string;
};

/**
 * Returns `basePrompt` with one short, server-authored temporal suffix
 * appended — deterministic for identical inputs, never touching
 * `basePrompt`'s own text. Contains only the current date and the
 * timezone name: no organizationId, userId, name, email, ref, or other
 * identifier of any kind.
 */
export function buildEffectiveSystemPrompt({ basePrompt, now, timezone }: TemporalContextInput): string {
  const currentDate = formatIsoDateInTimeZone(now, timezone);
  const temporalSuffix = `Authoritative current date: ${currentDate} (IANA timezone: ${timezone}). Interpret every relative date or time reference — including "today", "tomorrow", "overdue", "this week", "next N days/weeks", and "this month" — relative to this date and timezone, not any other assumption.`;
  return `${basePrompt}\n\n${temporalSuffix}`;
}
