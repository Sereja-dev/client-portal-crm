/**
 * Phone Recovery, Slice B2 — a conservative, provider-agnostic shape
 * check for a user-submitted OTP code, applied BEFORE this app ever
 * spends a Twilio Verify API call on it. Twilio Verify codes are numeric
 * and, depending on the Verify Service's own configuration, between 4
 * and 10 digits (6 is Twilio's own default) — this accepts that whole
 * range rather than hard-coding 6, so a future Service-level length
 * change never needs a matching app change. Never the actual security
 * boundary (Twilio's own VerificationCheck is) — purely a cheap,
 * honest-input filter that also lets the UI show an inline "enter a
 * valid code" error without a round-trip.
 */
const MIN_OTP_LENGTH = 4;
const MAX_OTP_LENGTH = 10;
const DIGITS_ONLY = /^[0-9]+$/;

export function isValidOtpCodeFormat(code: string): boolean {
  return code.length >= MIN_OTP_LENGTH && code.length <= MAX_OTP_LENGTH && DIGITS_ONLY.test(code);
}
