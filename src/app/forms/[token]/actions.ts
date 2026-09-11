"use server";

import { checkRateLimit, getRequestIp, LEAD_CAPTURE_SUBMIT_LIMIT } from "@/lib/rate-limit";
import { submitPublicLeadCaptureForm } from "@/lib/lead-capture-forms/public";
import type { PublicLeadCaptureFieldErrors } from "@/lib/validation/lead-capture-form";

/**
 * Public Lead Capture Forms, Phase 1 — the one public, unauthenticated
 * mutation this phase ships. A plain Server Action bound to the public
 * page's own `<form action={...}>`, the exact same established shape as
 * every other genuinely-unauthenticated entry point in this app (signup,
 * login, portal signup, invitation accept — see e.g.
 * src/app/(auth)/signup/actions.ts) rather than a JSON Route Handler:
 * this app has no existing public JSON API convention to follow, and a
 * Server Action already gets the same CSRF-equivalent protection
 * (Next.js's own Origin check on every Server Action request) and the
 * same global body-size cap (next.config.ts's `serverActions.bodySizeLimit`)
 * a hand-rolled Route Handler would need to reimplement — nothing here
 * requires (or incorrectly imposes) this app's authenticated-browser CSRF
 * logic, since there isn't any beyond that framework-level Origin check.
 */

export type LeadCaptureSubmissionState = {
  error: string | null;
  fieldErrors?: PublicLeadCaptureFieldErrors;
  success?: boolean;
  successMessage?: string | null;
};

const GENERIC_ERROR = "This form is not available.";

export async function submitLeadCaptureFormAction(
  token: string,
  _prevState: LeadCaptureSubmissionState,
  formData: FormData,
): Promise<LeadCaptureSubmissionState> {
  // Keyed by IP — the only identity a public, unauthenticated submitter
  // has. Checked before any DB read, same ordering every other
  // unauthenticated action in this app already uses.
  const ip = await getRequestIp();
  const limitCheck = checkRateLimit(LEAD_CAPTURE_SUBMIT_LIMIT, ip);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const result = await submitPublicLeadCaptureForm(token, {
    name: formData.get("name"),
    company: formData.get("company"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    message: formData.get("message"),
    honeypot: formData.get("website"),
  });

  if (result.ok) {
    // A honeypot-triggered discard renders identically to a real success
    // — no field in this response ever distinguishes the two cases.
    return { error: null, success: true, successMessage: "successMessage" in result ? result.successMessage : null };
  }

  if (result.reason === "NOT_FOUND") {
    // Never distinguishes "no such form" from "form exists but is
    // inactive/archived" from "organization doesn't exist" — one generic
    // message for all three, matching the invite-token page's own
    // convention.
    return { error: GENERIC_ERROR };
  }

  return { error: null, fieldErrors: result.fieldErrors };
}
