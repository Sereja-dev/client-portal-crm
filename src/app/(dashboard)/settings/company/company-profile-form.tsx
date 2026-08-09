"use client";

import { useActionState } from "react";
import { updateCompanyProfileAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import type { CompanyProfileFormState } from "@/types";
import type { CompanyProfileData } from "@/lib/organization-setup/company-profile";

const initialState: CompanyProfileFormState = { error: null };

export function CompanyProfileForm({
  profile,
  currencies,
  timezones,
}: {
  profile: CompanyProfileData;
  currencies: readonly string[];
  timezones: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(updateCompanyProfileAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <FormField label="Legal company name" htmlFor="legalName" required error={state.fieldErrors?.legalName}>
        <Input
          id="legalName"
          name="legalName"
          type="text"
          defaultValue={profile.legalName ?? ""}
          aria-invalid={!!state.fieldErrors?.legalName}
          required
        />
      </FormField>

      <FormField label="Display / company name" htmlFor="displayName" required error={state.fieldErrors?.displayName}>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          defaultValue={profile.displayName}
          aria-invalid={!!state.fieldErrors?.displayName}
          required
        />
      </FormField>

      <FormField label="Country" htmlFor="country" required error={state.fieldErrors?.country}>
        <Input
          id="country"
          name="country"
          type="text"
          defaultValue={profile.country ?? ""}
          aria-invalid={!!state.fieldErrors?.country}
          required
        />
      </FormField>

      <FormField label="Currency" htmlFor="currency" required error={state.fieldErrors?.currency}>
        <select
          id="currency"
          name="currency"
          defaultValue={profile.currency ?? ""}
          aria-invalid={!!state.fieldErrors?.currency}
          required
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-black focus:ring-1 focus:ring-black focus:outline-none"
        >
          <option value="" disabled>
            Select a currency
          </option>
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Time zone" htmlFor="timezone" required error={state.fieldErrors?.timezone}>
        <select
          id="timezone"
          name="timezone"
          defaultValue={profile.timezone ?? ""}
          aria-invalid={!!state.fieldErrors?.timezone}
          required
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-black focus:ring-1 focus:ring-black focus:outline-none"
        >
          <option value="" disabled>
            Select a time zone
          </option>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </FormField>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-600">
          {state.message}
        </p>
      )}

      <Button type="submit" loading={pending} data-testid="settings-save-button">
        {pending ? "Saving…" : "Save company profile"}
      </Button>
    </form>
  );
}
