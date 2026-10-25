"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateUser } from "@/lib/current-user";
import { normalizePhoneNumber, isSupportedPhoneCountry, isValidOtpCodeFormat, type CountryCode } from "@/lib/phone";
import {
  twilioVerifyProvider,
  checkPhoneVerificationProviderReadiness,
  type PhoneVerificationProvider,
} from "@/lib/phone/twilio-verify";
import { checkRateLimit, RECOVERY_PHONE_SEND_CODE_LIMIT, RECOVERY_PHONE_VERIFY_CODE_LIMIT } from "@/lib/rate-limit";

const ACCOUNT_SETTINGS_PATH = "/settings/account";

export type RecoveryPhoneFormState = {
  error: string | null;
  message?: string | null;
};

const EMPTY_PHONE_ERROR = "Enter a phone number.";
const DUPLICATE_PHONE_ERROR = "This phone number is already in use.";

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). The one truthful reason a verified phone can't
 * be changed/removed through this action yet — B2 (not shipped) is where
 * a safe, re-authenticated phone-change flow is designed and built (see
 * the audit's own §N). Identical wording to the Settings UI's own
 * read-only-state copy, deliberately — this message is the server-side
 * enforcement of the exact same rule the UI already doesn't offer an
 * edit control for, never a different, surprising rejection reason.
 */
const VERIFIED_PHONE_LOCKED_ERROR =
  "Changing a verified recovery phone will be available after re-authentication support is added.";

/**
 * This action's own `prisma.user.update` call only ever writes
 * `phone`/`phoneVerifiedAt` — `User.phone` is the only unique
 * constraint either of those columns can violate, so unlike
 * src/lib/invoices/write-conflict-mapper.ts's own field-matching
 * disambiguation (needed there because an Invoice write can hit either
 * of two different unique constraints in the same transaction), a bare
 * P2002 here is unambiguous — never a different constraint mislabeled
 * as "duplicate phone".
 */
function isPhoneUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * The one Server Action behind both Settings buttons ("Save"/"Add" and
 * "Remove"), distinguished by the native submit button's own
 * `name="intent"` value — not a second action, so the Settings form has
 * exactly one `useActionState` hook and one shared pending/error state
 * for both operations (see recovery-phone-settings.tsx).
 *
 * Identity is resolved server-side via `getOrCreateUser()` alone,
 * mirroring (dashboard)/theme-actions.ts's own `updateThemeModeAction`
 * exactly: no organizationId in scope, no membership resolution, and
 * the client can never supply (or influence) which User row this
 * touches — only the calling identity's own row is ever read or
 * written.
 *
 * Verified-phone protection is checked FIRST, before either branch —
 * B1 never offers a working edit path for a verified phone, regardless
 * of intent. This is defense in depth: the Settings UI already doesn't
 * render an editable form once `phoneVerifiedAt` is set, so a request
 * that reaches this far with `user.phoneVerifiedAt` non-null can only
 * be a forged/replayed submission, not a real UI interaction — still
 * rejected the same way, with the same truthful message.
 */
export async function updateRecoveryPhoneAction(
  _prevState: RecoveryPhoneFormState,
  formData: FormData,
): Promise<RecoveryPhoneFormState> {
  const user = await getOrCreateUser();

  if (user.phoneVerifiedAt) {
    return { error: VERIFIED_PHONE_LOCKED_ERROR };
  }

  const intent = String(formData.get("intent") ?? "save");

  if (intent === "remove") {
    if (!user.phone) {
      // Nothing to remove — not an error (e.g. a stale/double-submitted
      // form), just a no-op reported honestly.
      return { error: null, message: "No recovery phone to remove." };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { phone: null, phoneVerifiedAt: null },
    });

    revalidatePath(ACCOUNT_SETTINGS_PATH);
    return { error: null, message: "Recovery phone removed." };
  }

  const rawPhone = String(formData.get("phone") ?? "").trim();
  const rawCountry = String(formData.get("country") ?? "");
  const country: CountryCode | undefined = isSupportedPhoneCountry(rawCountry) ? rawCountry : undefined;

  if (!rawPhone) {
    return { error: EMPTY_PHONE_ERROR };
  }

  const normalized = normalizePhoneNumber(rawPhone, country);
  if (!normalized.ok) {
    return { error: normalized.error };
  }

  // Canonical-equivalence short-circuit — two different raw inputs that
  // normalize to the exact same E.164 string represent the same real
  // phone number (see normalizePhoneNumber's own doc comment for the
  // guarantee this relies on). This branch only ever applies to a
  // currently-UNVERIFIED stored phone (the guard above already returned
  // for a verified one) — still, unconditionally skipping the write
  // whenever nothing actually changed is correct regardless, and avoids
  // an unnecessary `updatedAt` bump for a no-op submission.
  if (user.phone === normalized.e164) {
    return { error: null, message: "Recovery phone saved." };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        phone: normalized.e164,
        // A genuinely different number ALWAYS clears verification state
        // — see schema.prisma's own phoneVerifiedAt doc comment for why
        // this must never be skipped. This slice never sets
        // phoneVerifiedAt non-null in the first place (so this is a
        // null -> null write today), but the invariant is enforced here
        // now so a future verification-writing slice inherits a write
        // path that already can't violate it.
        phoneVerifiedAt: null,
      },
    });
  } catch (err) {
    if (isPhoneUniqueConstraintViolation(err)) {
      // Never disclose who the number actually belongs to — no email,
      // no organization, no verification state of the other account.
      return { error: DUPLICATE_PHONE_ERROR };
    }
    throw err;
  }

  revalidatePath(ACCOUNT_SETTINGS_PATH);
  return { error: null, message: "Recovery phone saved." };
}

const NO_PHONE_ERROR = "Add a phone number first.";
const ALREADY_VERIFIED_MESSAGE = "This phone number is already verified.";
const INVALID_CODE_ERROR = "That code is invalid or has expired. Request a new one.";
const PROVIDER_UNAVAILABLE_ERROR = "Phone verification isn't available right now. Please try again later.";
const RATE_LIMITED_SEND_ERROR = "Too many attempts. Please wait before requesting another code.";
const PHONE_CHANGED_ERROR = "This phone number changed before verification completed. Request a new code.";

/**
 * Phone Recovery, Slice B2. `deps.provider` mirrors
 * src/app/(auth)/signup/actions.ts's own `deps: SignupDeps = {}` seam
 * exactly — defaults to the real `twilioVerifyProvider`, overridable by
 * integration tests with a `FakePhoneVerificationProvider`. Readiness
 * (`checkPhoneVerificationProviderReadiness`) is only ever consulted for
 * the REAL default provider — an explicitly injected test double has no
 * Twilio credentials to be "configured", and must never be blocked by a
 * check that exists solely to protect the real one.
 */
export type PhoneVerificationDeps = {
  provider?: PhoneVerificationProvider;
};

/**
 * Sends a fresh OTP to the phone ALREADY stored on the calling user's
 * own row — never a phone the client supplies. This is the whole point
 * of the critical security boundary the audit/brief both call out: the
 * browser cannot name an arbitrary destination for the server to trust,
 * because it is never asked to. `user.phone` here is a fresh read from
 * `getOrCreateUser()` on every call, not a value carried over from an
 * earlier request.
 */
export async function sendRecoveryPhoneVerificationCodeAction(
  _prevState: RecoveryPhoneFormState,
  _formData: FormData,
  deps: PhoneVerificationDeps = {},
): Promise<RecoveryPhoneFormState> {
  const user = await getOrCreateUser();

  if (user.phoneVerifiedAt) {
    return { error: null, message: ALREADY_VERIFIED_MESSAGE };
  }
  if (!user.phone) {
    return { error: NO_PHONE_ERROR };
  }

  const limitCheck = checkRateLimit(RECOVERY_PHONE_SEND_CODE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const provider = deps.provider ?? twilioVerifyProvider;
  if (!deps.provider && checkPhoneVerificationProviderReadiness() === "not_configured") {
    return { error: PROVIDER_UNAVAILABLE_ERROR };
  }

  const result = await provider.sendCode(user.phone);
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return { error: RATE_LIMITED_SEND_ERROR };
    }
    // "not_configured"/"provider_error"/"network_error" all collapse to
    // the same generic message — never the specific provider failure
    // class (see twilio-verify.ts's own doc comment on never exposing
    // provider internals).
    return { error: PROVIDER_UNAVAILABLE_ERROR };
  }

  return { error: null, message: "Verification code sent." };
}

/**
 * Verifies a user-submitted code against the phone ALREADY stored on the
 * calling user's own row — the same "server reads the destination,
 * never trusts the client" rule sendRecoveryPhoneVerificationCodeAction
 * follows. Input is the code only; identity and phone are both resolved
 * server-side, never accepted as parameters.
 *
 * Race/change protection: `phoneAtVerifyTime` is captured from this same
 * fresh `getOrCreateUser()` read, immediately before the provider call —
 * if a concurrent Replace (a second request/tab) changes `User.phone`
 * between that read and this function's own final write, the write
 * below targets `phone: phoneAtVerifyTime` in its WHERE clause, so a
 * changed phone makes `updateMany`'s count 0 and this fails closed
 * rather than marking a DIFFERENT, now-current phone verified off a
 * code that was never checked against it. This is the same invariant
 * that makes "send to Phone A, replace with Phone B, submit A's code"
 * fail: the provider check itself already denies a code that wasn't
 * issued for the phone being checked (see twilio-verify.ts's own 404
 * handling), and this conditional write is the second, independent
 * layer in case the provider call and the DB write race each other.
 */
export async function verifyRecoveryPhoneCodeAction(
  _prevState: RecoveryPhoneFormState,
  formData: FormData,
  deps: PhoneVerificationDeps = {},
): Promise<RecoveryPhoneFormState> {
  const user = await getOrCreateUser();

  if (user.phoneVerifiedAt) {
    return { error: null, message: ALREADY_VERIFIED_MESSAGE };
  }
  if (!user.phone) {
    return { error: NO_PHONE_ERROR };
  }

  const limitCheck = checkRateLimit(RECOVERY_PHONE_VERIFY_CODE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const rawCode = String(formData.get("code") ?? "").trim();
  if (!isValidOtpCodeFormat(rawCode)) {
    return { error: INVALID_CODE_ERROR };
  }

  const phoneAtVerifyTime = user.phone;
  const provider = deps.provider ?? twilioVerifyProvider;
  if (!deps.provider && checkPhoneVerificationProviderReadiness() === "not_configured") {
    return { error: PROVIDER_UNAVAILABLE_ERROR };
  }

  const result = await provider.verifyCode(phoneAtVerifyTime, rawCode);
  if (!result.ok) {
    return { error: PROVIDER_UNAVAILABLE_ERROR };
  }
  if (result.outcome !== "approved") {
    return { error: INVALID_CODE_ERROR };
  }

  const updateResult = await prisma.user.updateMany({
    where: { id: user.id, phone: phoneAtVerifyTime },
    data: { phoneVerifiedAt: new Date() },
  });

  if (updateResult.count === 0) {
    return { error: PHONE_CHANGED_ERROR };
  }

  revalidatePath(ACCOUNT_SETTINGS_PATH);
  return { error: null, message: "Phone verified." };
}
