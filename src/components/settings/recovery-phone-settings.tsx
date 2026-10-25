"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateRecoveryPhoneAction, type RecoveryPhoneFormState } from "@/app/(dashboard)/settings/account/actions";
import { PhoneVerificationControls } from "@/components/settings/phone-verification-controls";
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
 * Phone Recovery Foundation, Slice B1/B2 (read-only architecture audit:
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
 * Slice B2 — the Send/Verify OTP flow lives in its own
 * PhoneVerificationControls, rendered WITHOUT a `key` tied to the phone
 * — deliberately: if a Staff user sends a code for Phone A, then uses
 * the Replace form directly below to switch to Phone B without
 * reloading, the code-entry box stays exactly as they left it, and
 * submitting Phone A's code still runs through the real server
 * round-trip (see verifyRecoveryPhoneCodeAction's own doc comment) —
 * which re-reads `User.phone` fresh and correctly rejects it as
 * "invalid or has expired", the exact same honest outcome a user would
 * get from mistyping. Resetting this box on Replace was considered and
 * rejected: it would silently discard a legitimate in-flight attempt
 * the instant the user also happened to be mid-Replace in another tab,
 * for no security benefit — the server-side check is unconditional and
 * doesn't depend on which UI state is showing.
 *
 * Country-selector post-action reset (Production defect, fixed here) —
 * root cause, confirmed empirically (not guessed): the Save/Remove
 * `<form action={formAction}>` submits through React's real form-action
 * lifecycle, and once that settles (success OR failure — reproduced for
 * both), React itself calls the native `form.reset()` as part of that
 * SAME commit — before any effect runs — to mimic a real browser form
 * submission for progressive enhancement. `form.reset()` reverts every
 * form-associated control to its OWN static HTML default, and the
 * country `<select>`'s SSR'd markup never bakes a `selected` attribute
 * onto any `<option>` (React manages a controlled select via the
 * element's `.value` DOM property, not the `selected` attribute), so
 * its static default is simply "whichever `<option>` is first in DOM
 * order" — alphabetically "Afghanistan". Because the reset fires as
 * part of the SAME commit that processes the new `state`, neither a
 * plain `setState` call nor a `key`-forced remount reliably wins that
 * race (both were tried and empirically still showed Afghanistan) —
 * only code that runs strictly AFTER the commit, i.e. a `useEffect`,
 * is guaranteed to run after React's own reset call and can safely
 * overwrite whatever it left behind.
 *
 * Fix: a ref on the select plus one `useEffect` keyed on `state` — the
 * same "an effect is for synchronizing with an external system" case
 * React's own docs describe, the external system here being the DOM
 * node a native `form.reset()` just mutated outside React's view. After
 * every settled action, this imperatively re-asserts the select's
 * `.value` to the CORRECT country: the real default when the action
 * leaves no phone on file (a successful Remove), or whatever the user
 * already had selected otherwise (a successful Save/Replace, or any
 * failure) — matching the exact same intent-detection an earlier
 * (reverted) remount-based attempt used, just applied at a point in the
 * lifecycle where it actually takes effect. The phone text input needs
 * no equivalent ref: its own native reset-to-empty is already the
 * desired, unreported-as-broken behavior (see below), so nothing about
 * it needs correcting.
 */
export function RecoveryPhoneSettings({
  hasPhone,
  maskedPhone,
  isVerified,
  verificationAvailable,
}: {
  hasPhone: boolean;
  maskedPhone: string | null;
  isVerified: boolean;
  verificationAvailable: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateRecoveryPhoneAction, initialState);
  const [country, setCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [phoneInput, setPhoneInput] = useState("");
  const countrySelectRef = useRef<HTMLSelectElement>(null);
  const isFirstRender = useRef(true);
  // Tracks `hasPhone` as of the last settled action — NOT the same as
  // "`hasPhone` is currently false", which is also true for a failed Add
  // that never had a phone to begin with. Only a TRUE -> FALSE
  // transition is a successful Remove; a failed Add/Replace (hasPhone
  // false or true both before and after) must never be treated the same
  // way, or a failed Add would wrongly reset the user's own in-progress
  // country selection back to the default (reproduced and confirmed
  // while building this fix).
  const previousHasPhoneRef = useRef(hasPhone);

  useEffect(() => {
    // Skip the initial mount — there is nothing to correct yet (the
    // select already shows the right default, freshly hydrated, and no
    // native reset has fired). This effect's whole purpose only starts
    // to apply once a FORM ACTION has actually settled.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      previousHasPhoneRef.current = hasPhone;
      return;
    }

    const phoneWasJustRemoved = previousHasPhoneRef.current && !hasPhone;
    previousHasPhoneRef.current = hasPhone;

    // A successful Remove returns the selector to the real default;
    // every other settled action (a successful Save/Replace, or any
    // failure — including a failed Add that never had a phone at all)
    // keeps whatever the user already had selected.
    const correctedCountry = phoneWasJustRemoved ? DEFAULT_PHONE_COUNTRY : country;
    if (phoneWasJustRemoved) {
      setCountry(DEFAULT_PHONE_COUNTRY);
    }
    // The phone text input's own reset-to-empty (the browser's native
    // default for an input with no defaultValue) is left exactly as is
    // — matching the app's existing, unreported, already-correct
    // behavior of clearing the field after any settled submission — so
    // only React's own `phoneInput` state is resynced to match, never
    // the DOM value itself.
    setPhoneInput("");

    // Imperative, unconditional write — deliberately not gated on
    // "did the value actually change", because the whole point is to
    // overwrite whatever form.reset() already put in the DOM, which
    // React's own props/state bookkeeping has no visibility into.
    if (countrySelectRef.current) countrySelectRef.current.value = correctedCountry;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally fires only on a new settled `state`, not on every `country`/`hasPhone` render.
  }, [state]);

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
        <PhoneVerificationControls verificationAvailable={verificationAvailable} />
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
                ref={countrySelectRef}
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
