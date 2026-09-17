"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import { applyIndustryPreset } from "@/lib/industry-presets/apply";
import type { ApplyPresetFormState } from "./form-state";

/**
 * Industry Presets V1 (Settings → Industry Presets) — the one mutating
 * Server Action for this feature (locked spec §9). `presetKey` is the
 * only meaningful input (bound at the call site, never read from
 * FormData) — organizationId/actor are always resolved server-side via
 * getCurrentMembership(), never trusted from client input, mirroring
 * settings/tags/actions.ts's own exact pattern. applyIndustryPreset
 * itself independently re-verifies the OWNER/ADMIN gate regardless of
 * what this page's own UI does or doesn't offer (Section 5: "the
 * boundary itself enforces it," not merely a hidden/disabled button).
 */

const LIST_PATH = "/settings/industry-presets";

/**
 * Deliberately takes no `prevState`/`formData` parameters at all -- this
 * action's own form (ApplyPresetButton) submits no fields, and neither
 * parameter would ever be read. useActionState always calls its action
 * with (prevState, formData) regardless of how many parameters the
 * function itself declares -- a function with fewer declared parameters
 * than a caller supplies simply never sees the extra arguments (plain
 * JS/TS call semantics; this is also why `applyIndustryPresetAction.bind(null,
 * presetKey)` below still satisfies ApplyPresetButton's own two-argument
 * `action` prop type). Omitting the parameter outright (rather than
 * declaring and ignoring it) is both simpler and lint-clean.
 */
export async function applyIndustryPresetAction(presetKey: string): Promise<ApplyPresetFormState> {
  const { user, organizationId, membership } = await getCurrentMembership(LIST_PATH);
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await applyIndustryPreset(organizationId, actor, presetKey);

  if (!result.ok) {
    if (result.reason === "FORBIDDEN") {
      return { error: "You don't have permission to do that." };
    }
    if (result.reason === "UNKNOWN_PRESET") {
      return { error: "This preset could not be found." };
    }
    // PRESET_SWITCH_NOT_SUPPORTED
    return {
      error: "Your workspace already has a different preset applied. Switching presets isn't supported yet.",
    };
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${presetKey}`);
  revalidatePath("/settings/custom-statuses");
  revalidatePath("/settings/custom-fields");
  revalidatePath("/settings/tags");
  return { error: null };
}
