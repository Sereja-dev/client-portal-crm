"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { callActionWithStaleRecovery } from "@/lib/action-error";
import type { ApplyPresetFormState } from "@/app/(dashboard)/settings/industry-presets/form-state";

const initialState: ApplyPresetFormState = { error: null };

/**
 * Industry Presets V1 — the one Apply button, mirroring
 * create-tag-button.tsx's own useActionState + callActionWithStaleRecovery
 * shape (see that file's own comment). No fields to fill in — `action` is
 * already bound to this one preset's key server-side (applyIndustryPresetAction
 * .bind(null, presetKey)), so this form only ever submits itself.
 */
export function ApplyPresetButton({
  action,
  presetDisplayName,
}: {
  action: (prevState: ApplyPresetFormState, formData: FormData) => Promise<ApplyPresetFormState>;
  presetDisplayName: string;
}) {
  const [state, formAction, pending] = useActionState(async (prevState: ApplyPresetFormState, formData: FormData) => {
    return callActionWithStaleRecovery(() => action(prevState, formData));
  }, initialState);

  return (
    <form action={formAction}>
      {state.error && (
        <p role="alert" className="text-danger mb-3 text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" loading={pending}>
        {pending ? "Applying…" : `Apply ${presetDisplayName}`}
      </Button>
    </form>
  );
}
