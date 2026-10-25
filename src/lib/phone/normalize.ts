import { parsePhoneNumberFromString, isSupportedCountry, type CountryCode, type PhoneNumber } from "libphonenumber-js";

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). The one place a raw, user-typed phone number
 * ever becomes either a validated `PhoneNumber` object or this app's
 * canonical storage value — a real, full E.164 string (e.g.
 * "+66812345678"), never a hand-rolled regex. `libphonenumber-js` is a
 * real, actively-maintained port of Google's libphonenumber with its own
 * bundled country metadata, not an ad-hoc pattern — the audit's own
 * explicit instruction ("Do NOT use ad-hoc regex as the primary
 * international phone validator") is a hard requirement, not a
 * preference.
 *
 * `defaultCountry` is only ever a parsing HINT for a number typed in
 * local format with no leading "+" — a number that already includes a
 * country code (e.g. "+1 555…") parses correctly regardless of this
 * value. Every caller must still let the Staff user pick/confirm a
 * country explicitly (see the Settings UI) rather than silently
 * defaulting every bare local-format input to one assumed country — see
 * this module's own call sites for that UI-level requirement; this file
 * only provides the primitive.
 */

export function isSupportedPhoneCountry(code: string): code is CountryCode {
  return isSupportedCountry(code);
}

/**
 * Parses and validates `input` against `defaultCountry` (used only when
 * `input` has no explicit "+" country-code prefix). Returns `null` for
 * anything that isn't a real, possible, valid phone number — never
 * throws, matching this app's established "validation failure is a
 * value, not an exception" convention (see e.g.
 * src/lib/auth/recovery-token.ts's own `{ ok: false }` shape).
 */
export function parsePhoneNumber(input: string, defaultCountry?: CountryCode): PhoneNumber | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const country = defaultCountry && isSupportedPhoneCountry(defaultCountry) ? defaultCountry : undefined;

  try {
    const parsed = parsePhoneNumberFromString(trimmed, country);
    return parsed && parsed.isValid() ? parsed : null;
  } catch {
    // parsePhoneNumberFromString throws on a handful of malformed inputs
    // (e.g. a string libphonenumber-js can't even attempt to tokenize) —
    // treated identically to "didn't parse", never surfaced as a crash.
    return null;
  }
}

export type NormalizePhoneNumberResult = { ok: true; e164: string } | { ok: false; error: string };

const INVALID_PHONE_ERROR = "Enter a valid phone number.";

/**
 * The one function that produces this app's canonical storage value.
 * Always a full E.164 string on success (`parsed.number` — libphonenumber-js's
 * own canonical form, e.g. "+66812345678") — never a locally-formatted
 * display string, never a partial/national number. Two different raw
 * inputs that represent the same real phone number (local format vs. "+"
 * format, with or without spaces/dashes) always normalize to the exact
 * same E.164 string — this is the canonical-equivalence guarantee the
 * server-side update action relies on to decide whether a submitted
 * number actually changed (see that action's own doc comment).
 */
export function normalizePhoneNumber(input: string, defaultCountry?: CountryCode): NormalizePhoneNumberResult {
  const parsed = parsePhoneNumber(input, defaultCountry);
  if (!parsed) {
    return { ok: false, error: INVALID_PHONE_ERROR };
  }
  return { ok: true, e164: parsed.number };
}
