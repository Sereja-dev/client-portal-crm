import { AsYouType, type CountryCode } from "libphonenumber-js";
import { parsePhoneNumber } from "./normalize";

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). Unmasked, human-readable display of a stored
 * (canonical E.164) phone number — e.g. "+66 81 234 5678". Distinct from
 * `maskPhoneNumber` (mask.ts): this is for a context where the Staff
 * user is looking at their *own* full number (e.g. a confirmation step),
 * never for a masked-recovery-option listing. Falls back to the raw
 * E.164 string for anything that fails to re-parse, same reasoning as
 * `maskPhoneNumber`'s own fallback.
 */
export function formatPhoneNumberForDisplay(e164: string): string {
  const parsed = parsePhoneNumber(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/**
 * Live "as you type" formatting for the Settings phone input — purely a
 * client-side typing affordance (inserts spaces/grouping as digits are
 * entered), never a validation step and never the value actually
 * submitted to the server. The server independently re-normalizes and
 * re-validates the raw submitted value via `normalizePhoneNumber`
 * (normalize.ts) regardless of what this produced client-side.
 */
export function formatPhoneNumberAsYouType(input: string, country?: CountryCode): string {
  return new AsYouType(country).input(input);
}
