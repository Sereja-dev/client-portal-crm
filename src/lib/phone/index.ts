export { parsePhoneNumber, normalizePhoneNumber, isSupportedPhoneCountry } from "./normalize";
export type { NormalizePhoneNumberResult } from "./normalize";
export { maskPhoneNumber } from "./mask";
export { formatPhoneNumberForDisplay, formatPhoneNumberAsYouType } from "./format";
export { getPhoneCountryOptions, DEFAULT_PHONE_COUNTRY } from "./countries";
export type { PhoneCountryOption } from "./countries";
export type { CountryCode } from "libphonenumber-js";
export { isValidOtpCodeFormat } from "./otp-format";

// Deliberately NOT re-exported here: ./twilio-verify (server-only — see
// its own `import "server-only"` — importing it through this shared
// barrel would make every Client Component that already imports from
// "@/lib/phone" (e.g. recovery-phone-settings.tsx) fail to build, since
// "server-only" poisons the whole module graph that imports it). Server
// Actions import "@/lib/phone/twilio-verify" directly instead.
