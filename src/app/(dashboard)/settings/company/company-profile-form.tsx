"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateCompanyProfileAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CurrencySelect } from "@/components/invoices/currency-select";
import { FormField } from "@/components/ui/form-field";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { callActionWithStaleRecovery } from "@/lib/action-error";
import { deepEqual } from "@/lib/forms/deep-equal";
import { useReportDirtyState } from "@/components/forms/use-report-dirty-state";
import type { CompanyProfileFormState } from "@/types";
import type { CompanyProfileData } from "@/lib/organization-setup/company-profile";

const initialState: CompanyProfileFormState = { error: null };

/**
 * Forms Improvement Slice C1b — the one normalized shape
 * CompanyProfileForm's own dirty-state comparison is built from.
 * CompanyProfileForm stays fully uncontrolled (unlike Invoice/Recurring
 * Invoice/Quote's own C1a integration, which already held every field
 * in React state) — every field here is still read straight from the
 * DOM via `FormData`, exactly as `updateCompanyProfileAction` itself
 * does server-side, never converted to `useState`. `RawCompanyProfile
 * Values` is the one raw-string shape both of this form's two actual
 * data sources — the server-persisted `profile` prop (the initial
 * baseline) and a live `FormData` read (every snapshot after that) —
 * get normalized through identically, so the two can never drift apart
 * from using two different rules.
 *
 * Deliberately NOT validation: an invalid-but-currently-typed value
 * (e.g. a malformed Brand color) still normalizes to a real string and
 * still counts as current Product state — this only decides what two
 * values mean for *comparison*, never whether either one is acceptable
 * to submit. The normalization rules themselves — trim required
 * fields; trim optional fields to `null` when empty; uppercase currency
 * — intentionally mirror src/lib/validation/company-profile.ts's own
 * `parseCompanyProfileForm`, duplicated here rather than imported, the
 * same established "keep both in sync, never share an import" rule
 * `CompanyProfileFormState.values` itself already documents for this
 * exact field list. Refactoring server validation to deduplicate this
 * is explicitly out of scope for this slice.
 */
export type CompanyProfileDirtySnapshot = {
  legalName: string;
  displayName: string;
  country: string;
  currency: string;
  timezone: string;
  supportEmail: string | null;
  website: string | null;
  phone: string | null;
  taxId: string | null;
  brandColor: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

type RawCompanyProfileValues = {
  legalName: string | null | undefined;
  displayName: string | null | undefined;
  country: string | null | undefined;
  currency: string | null | undefined;
  timezone: string | null | undefined;
  supportEmail: string | null | undefined;
  website: string | null | undefined;
  phone: string | null | undefined;
  taxId: string | null | undefined;
  brandColor: string | null | undefined;
  streetAddress: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  postalCode: string | null | undefined;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildCompanyProfileDirtySnapshot(raw: RawCompanyProfileValues): CompanyProfileDirtySnapshot {
  return {
    legalName: (raw.legalName ?? "").trim(),
    displayName: (raw.displayName ?? "").trim(),
    country: (raw.country ?? "").trim(),
    currency: (raw.currency ?? "").trim().toUpperCase(),
    timezone: (raw.timezone ?? "").trim(),
    supportEmail: trimmedOrNull(raw.supportEmail),
    website: trimmedOrNull(raw.website),
    phone: trimmedOrNull(raw.phone),
    taxId: trimmedOrNull(raw.taxId),
    brandColor: trimmedOrNull(raw.brandColor),
    streetAddress: trimmedOrNull(raw.streetAddress),
    city: trimmedOrNull(raw.city),
    state: trimmedOrNull(raw.state),
    postalCode: trimmedOrNull(raw.postalCode),
  };
}

/**
 * The one live-DOM read this slice ever performs: every plain `Input`
 * and the native Timezone `Select` primitive already fire a real native
 * `input`/`change` event the form-level listener below catches, so by
 * the time this runs, `FormData` already reflects the latest value for
 * all of them. CurrencySelect is the one exception — see this file's
 * own `recomputeCurrentSnapshot` for why its own onChange call site
 * passes an explicit override instead of relying on this alone.
 */
function readFormDataRaw(formData: FormData): RawCompanyProfileValues {
  return {
    legalName: formData.get("legalName") as string | null,
    displayName: formData.get("displayName") as string | null,
    country: formData.get("country") as string | null,
    currency: formData.get("currency") as string | null,
    timezone: formData.get("timezone") as string | null,
    supportEmail: formData.get("supportEmail") as string | null,
    website: formData.get("website") as string | null,
    phone: formData.get("phone") as string | null,
    taxId: formData.get("taxId") as string | null,
    brandColor: formData.get("brandColor") as string | null,
    streetAddress: formData.get("streetAddress") as string | null,
    city: formData.get("city") as string | null,
    state: formData.get("state") as string | null,
    postalCode: formData.get("postalCode") as string | null,
  };
}

/**
 * Company Profile Failed-Validation Form State Preservation -- the one
 * place every field's own `defaultValue` (and, for the two Select
 * fields, `key` too) decides between the just-attempted submission and
 * the persisted profile. `submitted` is `undefined` exactly when
 * `state.values` itself is absent (the initial render, or right after a
 * successful save -- updateCompanyProfileAction deliberately never
 * returns `values` on that branch, see its own doc comment) -- in that
 * case, and ONLY in that case, this falls back to the persisted value.
 * A `null` `submitted` (an optional field the user genuinely cleared on
 * a submission that failed for a DIFFERENT field) is NOT the same as
 * absent: it must render empty, never silently fall back to whatever
 * was last persisted -- this is exactly the distinction a bare `??`
 * across both levels at once would erase.
 */
function fieldDefault(submitted: string | null | undefined, persisted: string | null): string {
  return submitted !== undefined ? (submitted ?? "") : (persisted ?? "");
}

/**
 * Sale-Ready Phase A.1 (Business Identity), PR3. Same form, same
 * `updateCompanyProfileAction`, same `useActionState` pattern, same
 * validation/error-display contract as before this stage — every field
 * that existed here already (legalName/displayName/country/currency/
 * timezone) keeps its exact `name`, `required`-ness, and error key.
 * What's new is purely organizational: the previously flat field list is
 * now grouped into `<fieldset>`/`<legend>` sections so the page reads as
 * "configure your business," not a list of unrelated settings —
 * `<fieldset>` is the correct native grouping for related inputs *within
 * one form* (as opposed to the separate `<section>` elements
 * settings/billing already uses to group unrelated cards on one page).
 *
 * currency/timezone don't belong to any of this stage's five named
 * Business Identity sections (they're locale/operational settings, not
 * identity) — kept in Business, right where they already sat, rather
 * than inventing a sixth, unrequested section for two fields.
 *
 * Every new field is optional (no `required` attribute, matching
 * validation/company-profile.ts's own nullable contract) — an OWNER can
 * save with none of them filled in, exactly as they always could before
 * this stage existed.
 *
 * Forms Improvement Slice D1 — `CompanyProfileForm` is now this thin
 * outer wrapper; `CompanyProfileFormFields` below holds everything that
 * used to live directly here (the `<form>`, `useActionState`, every
 * field, and all of C1b's own dirty tracking), remounted via
 * `key={resetGeneration}` on confirmed Discard. See
 * `CompanyProfileFormFields`'s own header comment for exactly why a
 * remount — not native `form.reset()` — is the correct discard
 * mechanism, and why `profile` (received fresh here, unchanged, from
 * the Server Component page on every navigation/revalidation) is
 * already the right source for "restore to the LATEST successfully
 * saved value," not merely the first-mount one. This wrapper owns
 * nothing else — no duplicate baseline, no duplicate dirty state — so
 * there is exactly one authoritative place (inside the remounted
 * child) that ever decides what "clean" currently means.
 */
export function CompanyProfileForm({
  profile,
  currencies,
  timezones,
}: {
  profile: CompanyProfileData;
  currencies: readonly string[];
  timezones: readonly string[];
}) {
  const [resetGeneration, setResetGeneration] = useState(0);
  return (
    <CompanyProfileFormFields
      key={resetGeneration}
      profile={profile}
      currencies={currencies}
      timezones={timezones}
      onDiscard={() => setResetGeneration((generation) => generation + 1)}
    />
  );
}

/**
 * Forms Improvement Slice D1 — the discard mechanism is a remount, not
 * native `form.reset()`. CurrencySelect's own hidden
 * `<input type="hidden" value={currentValue}>` is React-`value`-driven
 * (confirmed directly during this slice's own readiness audit), so a
 * native reset has no effect on it at all — React simply re-renders it
 * right back to whatever internal state CurrencySelect still holds.
 * Only a full remount re-seeds that internal state from this
 * component's own current `defaultValue` props. Remounting also
 * destroys and recreates the `useActionState` call below, which is
 * exactly what correctly clears a stale validation error or success
 * message on Discard with no extra code — `state` simply starts over
 * at `initialState`.
 */
function CompanyProfileFormFields({
  profile,
  currencies,
  timezones,
  onDiscard,
}: {
  profile: CompanyProfileData;
  currencies: readonly string[];
  timezones: readonly string[];
  onDiscard: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    (prevState: CompanyProfileFormState, formData: FormData) =>
      callActionWithStaleRecovery(() => updateCompanyProfileAction(prevState, formData)),
    initialState,
  );

  // Forms Improvement Slice C1b — the initial clean baseline is built
  // directly from the persisted `profile` prop, the exact same source
  // every field's own `defaultValue={fieldDefault(...)}` already falls
  // back to on a clean initial render (never from a later asynchronous
  // profile-prop refresh, and never by reading the DOM, which doesn't
  // exist yet during this first render). `currentSnapshot` starts as
  // this identical value, so a pristine page always begins CLEAN.
  const initialSnapshot = buildCompanyProfileDirtySnapshot({
    legalName: profile.legalName,
    displayName: profile.displayName,
    country: profile.country,
    currency: profile.currency,
    timezone: profile.timezone,
    supportEmail: profile.supportEmail,
    website: profile.website,
    phone: profile.phone,
    taxId: profile.taxId,
    brandColor: profile.brandColor,
    streetAddress: profile.streetAddress,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postalCode,
  });
  const [baseline, setBaseline] = useState<CompanyProfileDirtySnapshot>(initialSnapshot);
  const [currentSnapshot, setCurrentSnapshot] = useState<CompanyProfileDirtySnapshot>(initialSnapshot);

  const formRef = useRef<HTMLFormElement>(null);
  // Forms Improvement Slice C1b — the candidate baseline, captured from
  // exactly what THIS submission's own FormData contains, at the moment
  // it is submitted — never promoted to `baseline` until a real
  // successful settlement confirms the server actually persisted it
  // (see the settlement effect below). Overwritten on every new submit;
  // a stale snapshot from an earlier failed attempt can never leak
  // forward into a later success.
  const pendingSubmittedSnapshotRef = useRef<CompanyProfileDirtySnapshot | null>(null);

  function recomputeCurrentSnapshot(overrides?: Partial<RawCompanyProfileValues>) {
    if (!formRef.current) return;
    const raw = readFormDataRaw(new FormData(formRef.current));
    setCurrentSnapshot(buildCompanyProfileDirtySnapshot({ ...raw, ...overrides }));
  }

  // Forms Improvement Slice C1b — submit-time candidate capture. A
  // non-preventing `onSubmit` runs during the exact same synchronous
  // native `submit` event React's own `action={formAction}` handling
  // reads `FormData` from (confirmed directly against the installed
  // react-dom source during this slice's own readiness audit), so this
  // is guaranteed to see exactly what the Server Action receives.
  // `preventDefault` is never called — the native action flow is
  // completely untouched.
  function handleSubmitCapture() {
    if (!formRef.current) return;
    pendingSubmittedSnapshotRef.current = buildCompanyProfileDirtySnapshot(readFormDataRaw(new FormData(formRef.current)));
  }

  // Forms Improvement Slice C1b — settlement handling. Keyed on the
  // whole `state` object (never `state.message` alone, since
  // `updateCompanyProfileAction` returns the identical message string
  // on every successful save, so a second or third consecutive success
  // would never re-trigger an effect keyed only on that string;
  // `updateCompanyProfileAction` returns a fresh object literal on
  // every call, so `state`'s own reference reliably changes on every
  // settlement, success or failure alike). Runs exactly two things on
  // every settlement:
  //   1. Resync `currentSnapshot` from the live DOM. React 19 performs
  //      a native post-settlement `form.reset()` on both outcomes
  //      without firing any input/change event, so the DOM may have
  //      already silently changed underneath whatever `onChange`/
  //      `onInput` last observed — reading it fresh here keeps the
  //      React-side "current" value from ever going stale relative to
  //      what the page actually shows.
  //   2. Promote the baseline, but ONLY on a real success-shaped
  //      settlement (a non-null `message`, no `fieldErrors`, no
  //      `values`, no top-level `error`) — and even then, promote the
  //      SUBMITTED snapshot captured above, never a fresh live-DOM
  //      read. This is the one safety property that matters: if the
  //      user edited the form again in the (now-impossible, thanks to
  //      the separately-shipped pending-disable fix, but still worth
  //      defending regardless) window between submitting and
  //      settling, the newly-dirty live value must never be mistaken
  //      for what the server actually just persisted.
  useEffect(() => {
    if (!formRef.current) return;
    const liveSnapshot = buildCompanyProfileDirtySnapshot(readFormDataRaw(new FormData(formRef.current)));
    setCurrentSnapshot(liveSnapshot);

    const isSuccess = state.message != null && state.fieldErrors === undefined && state.values === undefined && state.error === null;
    if (isSuccess && pendingSubmittedSnapshotRef.current) {
      setBaseline(pendingSubmittedSnapshotRef.current);
    }
  }, [state]);

  const isDirty = !deepEqual(currentSnapshot, baseline);
  useReportDirtyState(isDirty);

  const discardDialogRef = useRef<ConfirmDialogHandle>(null);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmitCapture}
      onInput={() => recomputeCurrentSnapshot()}
      onChange={() => recomputeCurrentSnapshot()}
      className={`mt-6 space-y-8 p-6 ${CARD_SURFACE_CLASSES}`}
    >
      {/*
        Company Settings Mid-Flight Edit Loss remediation — every field
        below stayed fully editable while a submission was pending, so a
        user who kept typing (or just tabbed to the next field) in the
        brief window between clicking Save and the action settling had
        that edit silently discarded by React 19's own post-settlement
        native form.reset() — on success *and* on a validation failure
        alike, since the reset fires either way. A single outer, disabled
        `<fieldset>` around every editable section is the narrow, native
        fix: once no edit can physically occur during that window, there
        is nothing left for the reset to discard. `disabled` on a
        `<fieldset>` propagates to every descendant form control via the
        browser's own native inheritance — no per-field `disabled` prop
        needed, and this never changes what gets captured into the
        submitted FormData (that capture happens synchronously at submit
        time, strictly before this re-render applies `disabled`). The
        five existing `<fieldset>`/`<legend>` sections below are
        untouched inside it; the Save button and the error/status
        messages stay outside, exactly where they already were.
      */}
      <fieldset disabled={pending} className="space-y-8">
        <fieldset className="space-y-4">
          <legend className="text-text-primary text-base font-semibold">Business</legend>

          <FormField label="Display / company name" htmlFor="displayName" required error={state.fieldErrors?.displayName}>
            <Input
              id="displayName"
              name="displayName"
              type="text"
              defaultValue={fieldDefault(state.values?.displayName, profile.displayName)}
              aria-invalid={!!state.fieldErrors?.displayName}
              required
            />
          </FormField>

          <FormField label="Legal company name" htmlFor="legalName" required error={state.fieldErrors?.legalName}>
            <Input
              id="legalName"
              name="legalName"
              type="text"
              defaultValue={fieldDefault(state.values?.legalName, profile.legalName)}
              aria-invalid={!!state.fieldErrors?.legalName}
              required
            />
          </FormField>

          <FormField label="Currency" htmlFor="currency" required error={state.fieldErrors?.currency}>
            {/*
              Company Profile Timezone Persistence Diagnostic — still keyed
              on fieldDefault(...), not the surrounding form and not bare
              `profile.currency` alone, after Forms Improvement Slice A1
              replaced the native select element here with CurrencySelect
              (uncontrolled mode: `defaultValue` + its own internal state,
              the same calling convention this field already used). The
              original defect this `key` fixed was native-select-element-
              specific (react-dom's own update-props path only re-runs
              updateOptions() when `multiple` changes, so a plain prop
              update never re-selects the right option after React 19's
              post-action native form.reset() — see the full original
              analysis in git history for this file). CurrencySelect is not
              a native select element and doesn't carry that specific bug, but
              the SEPARATE requirement the `key` also serves still applies
              to any uncontrolled field here: after a REJECTED save, a
              validation error on some OTHER field must never silently
              revert an already-changed, valid currency choice back to its
              last-persisted value. `key={fieldDefault(...)}` remains the
              mechanism for that — it forces a fresh mount (and therefore a
              fresh internal-state seed) exactly when the effective default
              changes, never the whole form (which would also discard
              useActionState's own in-flight success/error message), and
              CurrencySelect still never becomes a controlled input here.
            */}
            <CurrencySelect
              key={fieldDefault(state.values?.currency, profile.currency)}
              id="currency"
              name="currency"
              defaultValue={fieldDefault(state.values?.currency, profile.currency)}
              // Forms Improvement Slice C1b — CurrencySelect still never
              // becomes a controlled input (no `value` prop is passed;
              // see this field's own comment above). This `onChange` is
              // its already-supported uncontrolled "notify on commit"
              // callback, needed because committing a selection here
              // never fires a native input/change event the form-level
              // listener above could otherwise catch on its own (the
              // hidden hidden-input's value changes via a React
              // re-render, not native DOM mutation). The committed
              // value is passed explicitly as an override rather than
              // relying on a fresh FormData read, because React batches
              // this component's own state update — reading the DOM
              // again inside this same synchronous callback would still
              // see the previous value, one render behind.
              onChange={(value) => recomputeCurrentSnapshot({ currency: value })}
              supportedCurrencies={currencies}
              aria-invalid={!!state.fieldErrors?.currency}
              required
            />
          </FormField>

          <FormField label="Time zone" htmlFor="timezone" required error={state.fieldErrors?.timezone}>
            {/* See the Currency field's own comment above -- same defect, same fix. */}
            <Select
              key={fieldDefault(state.values?.timezone, profile.timezone)}
              id="timezone"
              name="timezone"
              defaultValue={fieldDefault(state.values?.timezone, profile.timezone)}
              aria-invalid={!!state.fieldErrors?.timezone}
              required
            >
              <option value="" disabled>
                Select a time zone
              </option>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </FormField>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-text-primary text-base font-semibold">Contact</legend>

          <FormField label="Support email" htmlFor="supportEmail" error={state.fieldErrors?.supportEmail}>
            <Input
              id="supportEmail"
              name="supportEmail"
              // Deliberately type="text", not type="email": a browser's own
              // native format validation would block submission before this
              // form's server-side validation ever runs, so a genuinely
              // invalid value would never reach parseCompanyProfileForm and
              // its own fieldError message would never have a chance to
              // display — the exact same reasoning as brandColor above,
              // and consistent with every other validated-but-optional
              // field on this form already being type="text".
              type="text"
              defaultValue={fieldDefault(state.values?.supportEmail, profile.supportEmail)}
              aria-invalid={!!state.fieldErrors?.supportEmail}
            />
          </FormField>

          <FormField label="Website" htmlFor="website" error={state.fieldErrors?.website}>
            <Input
              id="website"
              name="website"
              type="text"
              placeholder="https://"
              defaultValue={fieldDefault(state.values?.website, profile.website)}
              aria-invalid={!!state.fieldErrors?.website}
            />
          </FormField>

          <FormField label="Phone" htmlFor="phone" error={state.fieldErrors?.phone}>
            <Input
              id="phone"
              name="phone"
              type="text"
              defaultValue={fieldDefault(state.values?.phone, profile.phone)}
              aria-invalid={!!state.fieldErrors?.phone}
            />
          </FormField>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-text-primary text-base font-semibold">Address</legend>

          <FormField label="Country" htmlFor="country" required error={state.fieldErrors?.country}>
            <Input
              id="country"
              name="country"
              type="text"
              defaultValue={fieldDefault(state.values?.country, profile.country)}
              aria-invalid={!!state.fieldErrors?.country}
              required
            />
          </FormField>

          <FormField label="Street address" htmlFor="streetAddress" error={state.fieldErrors?.streetAddress}>
            <Input
              id="streetAddress"
              name="streetAddress"
              type="text"
              defaultValue={fieldDefault(state.values?.streetAddress, profile.streetAddress)}
              aria-invalid={!!state.fieldErrors?.streetAddress}
            />
          </FormField>

          <FormField label="City" htmlFor="city" error={state.fieldErrors?.city}>
            <Input
              id="city"
              name="city"
              type="text"
              defaultValue={fieldDefault(state.values?.city, profile.city)}
              aria-invalid={!!state.fieldErrors?.city}
            />
          </FormField>

          <FormField label="State / Province" htmlFor="state" error={state.fieldErrors?.state}>
            <Input
              id="state"
              name="state"
              type="text"
              defaultValue={fieldDefault(state.values?.state, profile.state)}
              aria-invalid={!!state.fieldErrors?.state}
            />
          </FormField>

          <FormField label="Postal code" htmlFor="postalCode" error={state.fieldErrors?.postalCode}>
            <Input
              id="postalCode"
              name="postalCode"
              type="text"
              defaultValue={fieldDefault(state.values?.postalCode, profile.postalCode)}
              aria-invalid={!!state.fieldErrors?.postalCode}
            />
          </FormField>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-text-primary text-base font-semibold">Tax</legend>

          <FormField label="Tax ID / VAT" htmlFor="taxId" error={state.fieldErrors?.taxId}>
            <Input
              id="taxId"
              name="taxId"
              type="text"
              defaultValue={fieldDefault(state.values?.taxId, profile.taxId)}
              aria-invalid={!!state.fieldErrors?.taxId}
            />
          </FormField>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-text-primary text-base font-semibold">Branding</legend>

          {/*
            Deliberately type="text", not type="color": a native color
            input has no "empty" state — it always submits a real hex
            value (defaulting to black), which would silently overwrite
            this nullable field with #000000 on every unrelated save for
            an organization that never set one. A plain text field keeps
            "unset" genuinely empty, the same as every other optional field
            on this form.
          */}
          <FormField label="Brand color" htmlFor="brandColor" error={state.fieldErrors?.brandColor}>
            <Input
              id="brandColor"
              name="brandColor"
              type="text"
              placeholder="#RRGGBB"
              defaultValue={fieldDefault(state.values?.brandColor, profile.brandColor)}
              aria-invalid={!!state.fieldErrors?.brandColor}
            />
          </FormField>
        </fieldset>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-success text-sm">
          {state.message}
        </p>
      )}

      {/*
        Forms Improvement Slice D1 — the sticky action bar. Reuses the
        exact `sticky bottom-4 z-10 ... rounded-lg border ... shadow-lg`
        convention BulkActionBar/TaskBulkToolbar already ship in
        production inside this same (dashboard) layout, rather than
        inventing a new visual system. Lives inside this <form>, not
        beside it, so Save remains a genuine native submit button for
        this exact form. Save is always rendered (loading/disabled
        while pending, otherwise always enabled — unchanged from
        before); Discard renders only while `isDirty`, so a pristine
        form never shows a disabled ghost control, matching
        BulkActionBar's own "render nothing when there's nothing to act
        on" precedent.
      */}
      <div className="border-border-default bg-surface sticky bottom-4 z-10 mt-4 flex flex-col gap-2 rounded-lg border p-4 shadow-lg sm:flex-row">
        <Button type="submit" loading={pending}>
          {pending ? "Saving…" : "Save company profile"}
        </Button>
        {isDirty && (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => discardDialogRef.current?.open()}>
            Discard changes
          </Button>
        )}
      </div>

      <ConfirmDialog
        ref={discardDialogRef}
        title="Discard changes?"
        description="Your unsaved company profile changes will be lost. This can't be undone."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={onDiscard}
      />
    </form>
  );
}
