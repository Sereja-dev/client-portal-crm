"use server";

import { redirect } from "next/navigation";
import { createLeadAction } from "@/app/(dashboard)/leads/actions";
import { withToast } from "@/lib/toast-url";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import type { LeadFormState } from "@/types";

/**
 * Leads / Sales Pipeline Phase 3. A thin `useActionState`-compatible
 * adapter over createLeadAction (src/app/(dashboard)/leads/actions.ts,
 * Phase 2 — deliberately unchanged here): converts the raw FormData this
 * form submits into createLeadAction's own plain-object input shape, and
 * maps its discriminated-union result onto the same {error, fieldErrors}
 * shape ClientFormState/ProjectFormState/TaskFormState already use, so
 * LeadForm can reuse their exact rendering conventions. Never re-
 * implements validation, rate limiting, or the assignee/organization
 * checks themselves — those all still live in createLeadAction alone.
 */
export async function createLeadFormAction(
  _prevState: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const result = await createLeadAction({
    name: formData.get("name"),
    company: formData.get("company"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    source: formData.get("source"),
    value: formData.get("value"),
    notes: formData.get("notes"),
    assignedToUserId: formData.get("assignedToUserId"),
  });

  if (result.ok) {
    redirect(withToast("/leads", "Lead created"));
  }

  if (result.reason === "validation") {
    return { error: null, fieldErrors: result.fieldErrors };
  }
  if (result.reason === "rate_limited") {
    return { error: RATE_LIMIT_MESSAGE };
  }
  // "invalid_assignee" — the only remaining CreateLeadResult failure reason.
  return { error: null, fieldErrors: { assignedToUserId: "Select a valid team member." } };
}
