import { checkEmailProviderReadiness } from "@/lib/email/resend-client";

function trimmedEnv(name: string): string | null {
  const value = process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const SUPPORT_RECIPIENT_MAX_LENGTH = 254;

/**
 * Deliberately its own copy, not an import — matches validation.ts's own
 * identical reasoning for keeping this exact shape-check local to every
 * module that needs it.
 */
const SUPPORT_RECIPIENT_PATTERN = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

/**
 * Pre-Auth Support Widget V1, Slice B. Resolves the ONE recipient a
 * support message may ever be sent to — deliberately independent of
 * `getPlatformLegalConfig().supportEmail` (src/lib/legal/platform-
 * config.ts), which exists for DISPLAY purposes only (the /privacy,
 * /terms, footer, and organization-unavailable mailto links) and falls
 * back to an address extracted from `INVITATION_FROM_EMAIL` when
 * `PLATFORM_SUPPORT_EMAIL` itself is unset. That fallback is the wrong
 * contract for where a real support email actually gets SENT: silently
 * routing every support message to the transactional sender mailbox
 * instead of a real support inbox — with no operator-visible signal
 * that nothing was actually configured — is exactly the failure mode
 * this resolver exists to prevent. `PLATFORM_SUPPORT_EMAIL` must be
 * explicitly set and valid, or this returns `null` and the caller fails
 * closed (see submit.ts) — never a fallback to any other env var.
 */
export function resolveSupportRecipient(): string | null {
  const configured = trimmedEnv("PLATFORM_SUPPORT_EMAIL");
  if (!configured) return null;
  if (configured.length > SUPPORT_RECIPIENT_MAX_LENGTH) return null;
  return SUPPORT_RECIPIENT_PATTERN.test(configured) ? configured : null;
}

export type SupportSubmissionReadiness = "ready" | "not_configured";

/**
 * Three independent facts, all required: the email provider itself
 * (RESEND_API_KEY + INVITATION_FROM_EMAIL, via the existing
 * checkEmailProviderReadiness — covers the FROM side and is "ready"
 * under TEST_MODE, matching every other email-sending flow in this
 * app), and the support recipient above (the TO side, which
 * checkEmailProviderReadiness has no opinion on and never did). Neither
 * check here ever reads or exposes a secret value — only a bounded
 * "ready"/"not_configured" category, the same contract
 * checkEmailProviderReadiness itself already established.
 *
 * Deliberately NOT bypassed for TEST_MODE beyond what
 * checkEmailProviderReadiness already does on its own — a future E2E
 * test exercising the real "ready" path must still set
 * PLATFORM_SUPPORT_EMAIL explicitly (the same way it would in a real
 * deployment), so this fail-closed behavior itself stays genuinely
 * testable rather than silently short-circuited.
 */
export function checkSupportSubmissionReadiness(): SupportSubmissionReadiness {
  if (checkEmailProviderReadiness() !== "ready") return "not_configured";
  if (resolveSupportRecipient() === null) return "not_configured";
  return "ready";
}
