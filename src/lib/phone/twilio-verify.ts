import "server-only";
import { TEST_MODE } from "@/lib/test-mode";

/**
 * Phone Recovery, Slice B2 — Application-owned Twilio Verify, never
 * Supabase Phone Auth. See this module's own architecture note at the
 * bottom of this file for the full reasoning; in short: Supabase Phone
 * Auth creates/attaches a phone-based Auth IDENTITY on the Supabase Auth
 * user (the same mechanism email/password and OAuth identities use), a
 * concept with no clean "verified, but never a login credential" mode —
 * using it here would risk silently introducing phone-login semantics
 * Product has explicitly rejected (§ Product Decisions: "NOT a login
 * identity"). Twilio Verify is reached directly over HTTPS instead,
 * completely bypassing Supabase for this feature — `User.phoneVerifiedAt`
 * is this app's own column, set only by this app's own server code,
 * never anything Supabase Auth's own user/identity model is aware of.
 *
 * A thin `fetch()` wrapper, not the `twilio` SDK — mirrors
 * src/lib/email/resend-client.ts's own identical reasoning (a REST API
 * authenticated with one static credential pair, callable with two POST
 * requests, is not worth a ~2MB dependency full of unrelated Voice/
 * Messaging/Lookup API surface this app will never use). Twilio Verify's
 * REST API: POST .../Verifications to start a check (send the code),
 * POST .../VerificationCheck to check a submitted code — both
 * Basic-Auth'd with Account SID : Auth Token, form-encoded bodies. See
 * https://www.twilio.com/docs/verify/api/verification and
 * https://www.twilio.com/docs/verify/api/verification-check.
 *
 * Twilio owns the ENTIRE OTP lifecycle — generation, expiry (the
 * Verify API's own default, not anything this app configures), and
 * per-verification attempt limiting are all server-side on Twilio's end.
 * This app never generates, stores, or hashes an OTP anywhere — see
 * PhoneVerificationProvider's own doc comment for why no new DB table
 * exists for this.
 */

const TWILIO_VERIFY_BASE_URL = "https://verify.twilio.com/v2";
const REQUEST_TIMEOUT_MS = 15_000;

export type SendCodeResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "provider_error" | "network_error" | "rate_limited" };

/**
 * `approved` is the only success outcome — every other Twilio Verify
 * status ("pending" i.e. wrong code, "canceled", "expired",
 * "max_attempts_reached", or no matching pending verification at all)
 * collapses to `denied`. The caller (verifyRecoveryPhoneCodeAction)
 * presents all of these identically to the user as one truthful, generic
 * "that code is invalid or has expired" message — never which specific
 * Twilio status caused it, matching this app's existing enumeration-safe
 * discipline (e.g. requestPasswordResetCore's own single generic
 * message).
 */
export type VerifyCodeOutcome = "approved" | "denied";

export type VerifyCodeResult =
  | { ok: true; outcome: VerifyCodeOutcome }
  | { ok: false; reason: "not_configured" | "provider_error" | "network_error" };

/**
 * The seam every caller (the two Server Actions) goes through —
 * Twilio-shaped in production, a deterministic in-memory fake under
 * TEST_MODE (this file) for E2E, and an independently-injectable fake
 * for vitest unit/integration tests (see actions.ts's own `deps.provider`
 * parameter, the same dependency-injection shape
 * requestPasswordResetCore's own `deps.generateToken`/`deps.sendEmail`
 * already establishes). No DB table exists for in-flight verifications —
 * Twilio Verify is itself the challenge store; this app's own identity-
 * binding invariant (never allow a stale challenge for a different phone
 * to verify the current one) is enforced independently by always reading
 * `User.phone` fresh immediately before both the send and the verify
 * call, and by the conditional DB write in verifyRecoveryPhoneCodeAction
 * (see that file's own doc comment) — not by anything stored here.
 */
export type PhoneVerificationProvider = {
  sendCode(phone: string): Promise<SendCodeResult>;
  verifyCode(phone: string, code: string): Promise<VerifyCodeResult>;
};

export type PhoneVerificationProviderReadiness = "ready" | "not_configured";

/**
 * Reports whether the provider is ready to send, as a bounded category
 * only — never the configured credentials themselves. Mirrors
 * checkEmailProviderReadiness()'s own exact shape (resend-client.ts).
 * Always "ready" under TEST_MODE — this sandbox has no real Twilio to
 * reach any more than it has real Supabase Auth or real Resend.
 */
export function checkPhoneVerificationProviderReadiness(): PhoneVerificationProviderReadiness {
  if (TEST_MODE) {
    return "ready";
  }
  if (hasTwilioCredentials()) {
    return "ready";
  }
  return "not_configured";
}

function hasTwilioCredentials(): boolean {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  return Boolean(accountSid?.trim() && authToken?.trim() && verifyServiceSid?.trim());
}

function basicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64")}`;
}

// TEST_MODE-only in-memory challenge store — the same "no real Twilio
// reachable in this sandbox, so E2E needs a deterministic local stand-in"
// reasoning as src/lib/auth/recovery-token.ts's own testTokenStore.
// Keyed by phone (E.164), one pending code per phone, single-use.
// globalThis, not a module-level variable — Next.js compiles Server
// Actions into separate bundle graphs even within one `next start`
// process (verified for recovery-token.ts's own identical store), so a
// plain module-level Map would end up as two independent instances
// across that split.
const TEST_MODE_CODE = "000000";
type TestChallenge = { code: string; expiresAt: number };
const globalForPhoneChallenges = globalThis as unknown as {
  e2ePhoneChallenges: Map<string, TestChallenge> | undefined;
};
const testChallengeStore =
  globalForPhoneChallenges.e2ePhoneChallenges ?? new Map<string, TestChallenge>();
globalForPhoneChallenges.e2ePhoneChallenges = testChallengeStore;
const TEST_CHALLENGE_TTL_MS = 10 * 60 * 1000;

async function sendCode(phone: string): Promise<SendCodeResult> {
  if (TEST_MODE) {
    testChallengeStore.set(phone, { code: TEST_MODE_CODE, expiresAt: Date.now() + TEST_CHALLENGE_TTL_MS });
    return { ok: true };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid?.trim() || !authToken?.trim() || !verifyServiceSid?.trim()) {
    return { ok: false, reason: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${TWILIO_VERIFY_BASE_URL}/Services/${verifyServiceSid}/Verifications`, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(accountSid, authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, Channel: "sms" }),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, reason: "network_error" };
    }

    // Twilio returns 429 for a project/number that's hit Verify's own
    // rate limiting — surfaced as its own distinct reason so the caller
    // can show a truthful "try again shortly" message rather than a
    // generic failure. Never logs the response body (see this file's
    // own header comment on never logging provider response bodies).
    if (response.status === 429) {
      return { ok: false, reason: "rate_limited" };
    }
    if (!response.ok) {
      return { ok: false, reason: "provider_error" };
    }
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyCode(phone: string, code: string): Promise<VerifyCodeResult> {
  if (TEST_MODE) {
    const entry = testChallengeStore.get(phone);
    // No pending challenge for THIS exact phone (never sent, already
    // consumed, or sent to a different number before a Replace) ->
    // denied, the same outcome real Twilio would report for a
    // VerificationCheck against a `To` with no matching pending
    // verification. This is what makes the "replace phone between send
    // and verify" invariant hold even in TEST_MODE without any extra
    // special-casing — verifyCode is always called with the CURRENT
    // phone (see actions.ts), and a stale code was only ever stored
    // under the OLD phone's key.
    if (!entry) {
      return { ok: true, outcome: "denied" };
    }
    if (Date.now() > entry.expiresAt) {
      testChallengeStore.delete(phone);
      return { ok: true, outcome: "denied" };
    }
    if (entry.code !== code) {
      // Wrong code — NOT single-use-consumed, matching real Twilio
      // (a wrong attempt doesn't invalidate the still-pending, still
      // correct code; the user can simply retry).
      return { ok: true, outcome: "denied" };
    }
    testChallengeStore.delete(phone);
    return { ok: true, outcome: "approved" };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid?.trim() || !authToken?.trim() || !verifyServiceSid?.trim()) {
    return { ok: false, reason: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${TWILIO_VERIFY_BASE_URL}/Services/${verifyServiceSid}/VerificationCheck`, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(accountSid, authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, Code: code }),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, reason: "network_error" };
    }

    // Twilio's VerificationCheck returns 404 for "no pending
    // verification found for this To" (e.g. expired, already consumed,
    // or — the exact case this app's own race-protection relies on —
    // a code that was sent to a DIFFERENT phone number than the one
    // being checked now) — a real, meaningful "denied" outcome, not a
    // provider malfunction.
    if (response.status === 404) {
      return { ok: true, outcome: "denied" };
    }
    if (!response.ok) {
      return { ok: false, reason: "provider_error" };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: "provider_error" };
    }

    const status = extractStatus(body);
    return { ok: true, outcome: status === "approved" ? "approved" : "denied" };
  } finally {
    clearTimeout(timer);
  }
}

function extractStatus(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const status = (body as Record<string, unknown>).status;
  return typeof status === "string" ? status : undefined;
}

/** The real production implementation, built from the two functions above — see PhoneVerificationProvider's own doc comment. */
export const twilioVerifyProvider: PhoneVerificationProvider = { sendCode, verifyCode };
