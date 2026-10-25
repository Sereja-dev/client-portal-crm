"use client";

import { useActionState, useState } from "react";
import { updateRecoveryPhoneAction, type RecoveryPhoneFormState } from "@/app/(dashboard)/settings/account/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormLabel } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { getPhoneCountryOptions, formatPhoneNumberAsYouType, DEFAULT_PHONE_COUNTRY, type CountryCode } from "@/lib/phone";

const initialState: RecoveryPhoneFormState = { error: null };

const COUNTRY_OPTIONS = getPhoneCountryOptions();

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). Server-rendered props, fully re-synced on every
 * Server Action-triggered re-render of the parent page — this component
 * holds no state of its own for `hasPhone`/`maskedPhone`/`isVerified`,
 * the same "server is the source of truth, client never shadows it"
 * shape AppearanceSelector's own doc comment establishes for
 * `useTheme().mode`.
 *
 * `maskedPhone` is the ONLY representation of the stored number this
 * component ever receives — the page (a Server Component) masks it
 * before passing it down, so the raw E.164 value never enters the
 * client bundle/RSC payload at all, not merely "isn't rendered". See
 * page.tsx's own doc comment for the full reasoning.
 *
 * Deliberately ONE `useActionState` hook shared by both the save-or-
 * replace form and the Remove button (see actions.ts's own doc comment
 * for why one Server Action handles both, via the submit button's own
 * `name="intent"` value) — one pending state, one error/message surface,
 * never two independent forms that could show stale or conflicting
 * feedback.
 *
 * No "Verify" control exists anywhere in this component — B2 (not
 * shipped) is where that becomes real. Exposing a disabled placeholder
 * was considered and rejected: the audit's own instruction ("Prefer not
 * to expose unfinished/dead-end UI if it can be avoided") is satisfied
 * more honestly by the explanatory copy alone than by a button that
 * does nothing.
 */
export function RecoveryPhoneSettings({
  hasPhone,
  maskedPhone,
  isVerified,
}: {
  hasPhone: boolean;
  maskedPhone: string | null;
  isVerified: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateRecoveryPhoneAction, initialState);
  const [country, setCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [phoneInput, setPhoneInput] = useState("");

  return (
    <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <h2 className="text-text-primary text-lg font-semibold">Recovery phone</h2>
      <p className="text-text-secondary mt-1 text-sm">
        Add a phone number that can be verified and used as an additional account recovery option.
      </p>

      {isVerified && hasPhone ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-text-primary font-medium">{maskedPhone}</span>
          <StatusBadge status="VERIFIED" label="Verified" tone="success" />
        </div>
      ) : null}
      {isVerified && (
        <p className="text-text-secondary mt-2 text-sm">
          This is a verified recovery phone. Changing a verified recovery phone will be available after
          re-authentication support is added.
        </p>
      )}

      {!isVerified && hasPhone ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-text-primary font-medium">{maskedPhone}</span>
          <StatusBadge status="NOT_VERIFIED" label="Not verified" tone="warning" />
        </div>
      ) : null}
      {!isVerified && hasPhone && (
        <p className="text-text-secondary mt-2 text-sm">
          Not verified — this number cannot be used for account recovery yet. Phone verification will be available
          soon.
        </p>
      )}

      {!isVerified && !hasPhone && <p className="text-text-secondary mt-4 text-sm">No recovery phone added.</p>}

      {!isVerified && (
        <form action={formAction} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_1fr]">
            <div>
              <FormLabel htmlFor="country">Country</FormLabel>
              <Select
                id="country"
                name="country"
                value={country}
                onChange={(event) => setCountry(event.target.value as CountryCode)}
              >
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name} (+{option.callingCode})
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <FormLabel htmlFor="phone">{hasPhone ? "New phone number" : "Phone number"}</FormLabel>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="81 234 5678"
                value={phoneInput}
                onChange={(event) => setPhoneInput(formatPhoneNumberAsYouType(event.target.value, country))}
                aria-invalid={!!state.error}
                aria-describedby={state.error ? "recovery-phone-error" : undefined}
              />
            </div>
          </div>

          {state.error && (
            <p id="recovery-phone-error" role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          )}
          {!state.error && state.message && (
            <p role="status" className="text-success text-sm">
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" name="intent" value="save" loading={pending} className="sm:w-auto">
              {pending ? "Saving…" : hasPhone ? "Save new number" : "Add phone number"}
            </Button>
            {hasPhone && (
              <Button
                type="submit"
                name="intent"
                value="remove"
                variant="secondary"
                loading={pending}
                className="sm:w-auto"
              >
                Remove
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
