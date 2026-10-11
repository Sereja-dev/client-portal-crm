"use client";

import { useActionState } from "react";
import { updateCompanyProfileAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CurrencySelect } from "@/components/invoices/currency-select";
import { FormField } from "@/components/ui/form-field";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { callActionWithStaleRecovery } from "@/lib/action-error";
import type { CompanyProfileFormState } from "@/types";
import type { CompanyProfileData } from "@/lib/organization-setup/company-profile";

const initialState: CompanyProfileFormState = { error: null };

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
  const [state, formAction, pending] = useActionState(
    (prevState: CompanyProfileFormState, formData: FormData) =>
      callActionWithStaleRecovery(() => updateCompanyProfileAction(prevState, formData)),
    initialState,
  );

  return (
    <form action={formAction} className={`mt-6 space-y-8 p-6 ${CARD_SURFACE_CLASSES}`}>
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

      <Button type="submit" loading={pending}>
        {pending ? "Saving…" : "Save company profile"}
      </Button>
    </form>
  );
}
