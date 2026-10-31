"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-user";
import {
  checkRateLimit,
  STAFF_BUG_REPORT_SUBMIT_LIMIT,
  STAFF_FEEDBACK_ORGANIZATION_LIMIT,
  STAFF_SUPPORT_SUBMIT_LIMIT,
  type RateLimitConfig,
} from "@/lib/rate-limit";
import { submitBugReport, submitStaffSupport, type StaffFeedbackIdentity } from "./submit";
import type { BugReportFieldErrors, StaffSupportFieldErrors } from "./validation";

/**
 * Authenticated Staff Feedback Widget — Server Actions for the "Support" and
 * "Report a bug" tabs. Deliberately thin, like the pre-auth widget's actions:
 * every real decision lives in submit.ts / validation.ts / config.ts.
 *
 * Identity is NEVER read from the form. The user, their role and the active
 * workspace are resolved server-side by getCurrentMembership() — which also
 * redirects an unauthenticated visitor or a Client Portal identity away — so a
 * crafted request cannot name another user or another organization. The only
 * FormData keys read are the fixed lists below (checked by
 * scripts/security-checks/check-feedback-widget-security.mjs).
 */

export type FeedbackActionState<FieldErrors> = {
  error: string | null;
  fieldErrors?: FieldErrors;
  success?: boolean;
  /** True when the same content/form had already been sent — shown as success, never re-sent. */
  duplicate?: boolean;
};

export type StaffSupportState = FeedbackActionState<StaffSupportFieldErrors>;
export type BugReportState = FeedbackActionState<BugReportFieldErrors>;

const SUPPORT_SEND_ERROR = "We couldn't send your message. Please try again in a moment.";
const BUG_SEND_ERROR = "We couldn't send your bug report. Please try again in a moment, or use the Support tab.";
// Distinguishing "not configured" is safe here (authenticated Staff, no
// account-existence signal) and far more useful than a silent generic error.
const BUG_NOT_CONFIGURED_ERROR = "Bug reporting isn't available yet. Please use the Support tab to tell us about the problem.";

async function resolveIdentity(): Promise<StaffFeedbackIdentity> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });
  return {
    userId: user.id,
    sender: { name: user.name ?? null, email: user.email, role: membership.role },
    workspace: { id: organization.id, name: organization.name, slug: organization.slug },
  };
}

function limited(config: RateLimitConfig, identity: StaffFeedbackIdentity): string | null {
  const perUser = checkRateLimit(config, identity.userId);
  if (perUser.limited) return perUser.message;
  const perOrganization = checkRateLimit(STAFF_FEEDBACK_ORGANIZATION_LIMIT, identity.workspace.id);
  return perOrganization.limited ? perOrganization.message : null;
}

export async function submitStaffSupportAction(_prev: StaffSupportState, formData: FormData): Promise<StaffSupportState> {
  const identity = await resolveIdentity();

  const limitMessage = limited(STAFF_SUPPORT_SUBMIT_LIMIT, identity);
  if (limitMessage) return { error: limitMessage };

  const result = await submitStaffSupport(
    {
      subject: formData.get("subject"),
      message: formData.get("message"),
      submissionId: formData.get("submissionId"),
      honeypot: formData.get("honeypot"),
    },
    identity,
  );

  if (result.ok) return { error: null, success: true, duplicate: result.duplicate === true };
  if (result.reason === "VALIDATION") return { error: null, fieldErrors: result.fieldErrors };
  return { error: SUPPORT_SEND_ERROR };
}

export async function submitBugReportAction(_prev: BugReportState, formData: FormData): Promise<BugReportState> {
  const identity = await resolveIdentity();

  const limitMessage = limited(STAFF_BUG_REPORT_SUBMIT_LIMIT, identity);
  if (limitMessage) return { error: limitMessage };

  const requestHeaders = await headers();
  const result = await submitBugReport(
    {
      title: formData.get("title"),
      description: formData.get("description"),
      steps: formData.get("steps"),
      expected: formData.get("expected"),
      actual: formData.get("actual"),
      route: formData.get("route"),
      viewportWidth: formData.get("viewportWidth"),
      viewportHeight: formData.get("viewportHeight"),
      submissionId: formData.get("submissionId"),
      honeypot: formData.get("honeypot"),
    },
    identity,
    { userAgent: requestHeaders.get("user-agent") },
  );

  if (result.ok) return { error: null, success: true, duplicate: result.duplicate === true };
  if (result.reason === "VALIDATION") return { error: null, fieldErrors: result.fieldErrors };
  if (result.reason === "NOT_CONFIGURED") return { error: BUG_NOT_CONFIGURED_ERROR };
  return { error: BUG_SEND_ERROR };
}
