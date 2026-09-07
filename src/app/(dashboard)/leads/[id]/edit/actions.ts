"use server";

import { redirect } from "next/navigation";
import { updateLeadAction } from "@/app/(dashboard)/leads/actions";
import { withToast } from "@/lib/toast-url";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import type { LeadFormState } from "@/types";

/**
 * Same adapter role as leads/new/actions.ts's own createLeadFormAction,
 * over updateLeadAction instead (Phase 2, unchanged). leadId is bound at
 * the page level (`updateLeadFormAction.bind(null, lead.id)`), matching
 * updateClientAction's own exact pattern.
 */
export async function updateLeadFormAction(
  leadId: string,
  _prevState: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const result = await updateLeadAction(leadId, {
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
    redirect(withToast("/leads", "Lead updated"));
  }

  if (result.reason === "validation") {
    return { error: null, fieldErrors: result.fieldErrors };
  }
  if (result.reason === "rate_limited") {
    return { error: RATE_LIMIT_MESSAGE };
  }
  if (result.reason === "not_found") {
    return { error: "This lead could not be found." };
  }
  // "invalid_assignee" — the only remaining UpdateLeadResult failure reason.
  return { error: null, fieldErrors: { assignedToUserId: "Select a valid team member." } };
}
