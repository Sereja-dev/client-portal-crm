import { getOrCreateUser } from "@/lib/current-user";
import { RecoveryPhoneSettings } from "@/components/settings/recovery-phone-settings";
import { maskPhoneNumber } from "@/lib/phone";
import { checkPhoneVerificationProviderReadiness } from "@/lib/phone/twilio-verify";

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). The first personal-identity Settings page to
 * read/write `User` fields directly via a real form — grouped in the
 * nav next to Appearance/Notifications (see settings-nav.tsx), the same
 * "personal, per-identity preference, not organization-wide config" tier
 * those two already occupy, open to any staff role (no role gate — a
 * recovery phone is the acting user's own, never an organization-level
 * setting).
 *
 * `getOrCreateUser()` is the same identity resolution every other
 * authenticated page already uses — no second, bespoke lookup. Staff-
 * only by construction: this route lives entirely under the (dashboard)
 * route group, which Portal has no path into at all.
 *
 * Masking happens HERE, server-side, before anything crosses to the
 * Client Component — RecoveryPhoneSettings never receives the raw
 * stored E.164 value at all, only the already-masked display string.
 * The UI only ever shows the masked form (maskPhoneNumber's own doc
 * comment), so there is no reason for the unmasked number to travel
 * into the client bundle/RSC payload in the first place — a stricter
 * guarantee than "the UI happens not to render it".
 *
 * Phone Recovery, Slice B2 — `verificationAvailable` is server-side
 * CAPABILITY DETECTION (checkPhoneVerificationProviderReadiness()),
 * never a public env flag: whether real Twilio credentials happen to be
 * configured on this deployment, resolved here and handed down as a
 * plain boolean. When false, the Client Component must not render a
 * live "Send code" control at all — see that component's own doc
 * comment for the exact truthful copy shown instead.
 */
export default async function AccountSettingsPage() {
  const user = await getOrCreateUser();

  return (
    <div>
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Account</h1>
      <p className="text-text-secondary mt-1 text-sm">Personal account and recovery settings.</p>

      <div className="mt-6">
        <RecoveryPhoneSettings
          hasPhone={user.phone !== null}
          maskedPhone={user.phone ? maskPhoneNumber(user.phone) : null}
          isVerified={user.phoneVerifiedAt !== null}
          verificationAvailable={checkPhoneVerificationProviderReadiness() === "ready"}
        />
      </div>
    </div>
  );
}
