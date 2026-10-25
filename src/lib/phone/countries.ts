import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";

export type PhoneCountryOption = {
  code: CountryCode;
  name: string;
  callingCode: string;
};

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). The country list for the Settings phone
 * selector — deliberately NOT a hand-maintained array (the audit's own
 * explicit instruction: "Do NOT create a huge custom country-picker
 * framework"). `getCountries()` (libphonenumber-js's own bundled
 * metadata) is already the complete, correct list of countries this
 * app's phone *validation* supports — reusing it here means the
 * selector can never offer a country the normalizer would then reject.
 * Display names come from `Intl.DisplayNames`, a standard, built-in
 * JS/Node API (available in every runtime this app already targets, no
 * new dependency) — no second country-name list to keep in sync with
 * the first.
 */
const displayNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

function countryDisplayName(code: CountryCode): string {
  return displayNames?.of(code) ?? code;
}

let cachedOptions: PhoneCountryOption[] | null = null;

/** Memoized — the underlying metadata is static for the life of the process, so this is computed once, not per render/request. */
export function getPhoneCountryOptions(): PhoneCountryOption[] {
  if (!cachedOptions) {
    cachedOptions = getCountries()
      .map((code) => ({
        code,
        name: countryDisplayName(code),
        callingCode: getCountryCallingCode(code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return cachedOptions;
}

/**
 * The Settings UI's initial selection — a UX default only, never a
 * silent assumption. The audit's own explicit requirement: "Do NOT
 * silently assume every bare local number is Thai without an explicit
 * country selection" — this value only pre-selects the dropdown; the
 * Staff user can change it before typing a number, and the server never
 * trusts a country value it wasn't given explicitly on submission.
 */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "TH";
