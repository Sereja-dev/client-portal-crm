import { parsePhoneNumber } from "./normalize";

const FALLBACK_MASK = "••••";
const VISIBLE_TRAILING_DIGITS = 2;
const GROUP_SIZE = 3;

function groupDigits(digits: string): string {
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += GROUP_SIZE) {
    groups.push(digits.slice(i, i + GROUP_SIZE));
  }
  return groups.join(" ");
}

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). The one place a stored phone number is ever
 * shown to a Staff user — reveals the country calling code (never
 * secret — it's a country, not an identifier) plus the last two digits
 * of the national number, masking everything in between. Matches this
 * slice's own audit's "masked phone" framing (§I's own
 * "+66 8•• ••• 678"-style example) closely enough to read as the same
 * design, without hard-coding that exact grouping.
 *
 * Input is always this app's own canonical E.164 value (never a raw,
 * unvalidated user input) — `parsePhoneNumber` re-parses it only to
 * split it cleanly into calling-code/national-number parts, not to
 * re-validate something this app already validated once at write time.
 * Falls back to a generic mask for anything that fails to re-parse
 * (should not happen for a value this app itself wrote, but never
 * throws on a malformed value either way).
 */
export function maskPhoneNumber(e164: string): string {
  const parsed = parsePhoneNumber(e164);
  if (!parsed) return FALLBACK_MASK;

  const national = parsed.nationalNumber;
  const visibleCount = Math.min(VISIBLE_TRAILING_DIGITS, national.length);
  const maskedCount = national.length - visibleCount;
  const masked = "•".repeat(maskedCount) + national.slice(national.length - visibleCount);

  return `+${parsed.countryCallingCode} ${groupDigits(masked)}`.trim();
}
