import { siteConfig } from "@/config/site";

export type PlatformBranding = {
  /** The product's own display name. Always a real value — falls back to siteConfig.name, never "Not set" (a platform necessarily has a name, unlike an optional address). */
  name: string;
  /** Falls back to siteConfig.description, same reasoning as `name`. */
  tagline: string;
  /** Optional. No platform-level logo exists anywhere in this app until an operator sets this — never a placeholder image. */
  logoUrl: string | null;
  /** Optional. Not read by anything in Next.js's own favicon resolution yet (Sale-Ready Phase D, D2 — display-only for now); reserved for a future PR to actually wire in. */
  faviconUrl: string | null;
};

export type PlatformEmailConfig = {
  /** Reused from getPlatformLegalConfig().supportEmail — same fact (one support mailbox), not a second independent source. */
  supportEmail: string | null;
  /** Distinct from supportEmail on purpose: a real operator may want billing inquiries routed to a different mailbox than general/legal support. No fallback exists for this one — inventing a billing contact from an unrelated address would be worse than an honest "Not set". */
  billingEmail: string | null;
  /** The address transactional emails (invitations, password resets) are actually sent from — reuses the same INVITATION_FROM_EMAIL address parsing sendEmailViaResend's own caller already relies on, not a second "from" concept. */
  senderEmail: string | null;
  /** Where a recipient's reply would go. Falls back to senderEmail when not explicitly set (the sender address is always a reasonable place for a reply to land) — see replyToConfigured for whether this is an explicit choice or that fallback. Not yet wired into any actual email send (display-only for now, same "documented ahead of the code that reads it" approach as PLATFORM_FAVICON_URL). */
  replyToEmail: string | null;
  /** The only email-sending integration this app has (see src/lib/email/resend-client.ts) — fixed, not env-driven, because there is nothing to choose between yet. */
  providerName: string;
  /** Whether RESEND_API_KEY is set — never the key's value itself, which is a secret and never rendered anywhere. */
  providerConfigured: boolean;
  /** Whether senderEmail resolved to a real address. */
  senderConfigured: boolean;
  /** True only when PLATFORM_REPLY_TO_EMAIL was explicitly set — false means replyToEmail above is senderEmail's fallback value, not an operator choice. */
  replyToConfigured: boolean;
};

export type PlatformLegalConfig = {
  /** Legal/trading name of the entity operating this Service. */
  legalName: string;
  /** Registered/mailing address, if the operator has configured one — never invented. */
  legalAddress: string | null;
  /** Contact address for privacy/legal requests, if configured. */
  supportEmail: string | null;
  /** Free-text jurisdiction description used in the governing-law clause. */
  jurisdiction: string;
  /** Human-readable effective date shown on the Privacy Policy page. */
  privacyEffectiveDate: string;
  /** Human-readable effective date shown on the Terms of Service page. */
  tosEffectiveDate: string;
};

/**
 * `INVITATION_FROM_EMAIL` is formatted as either `"Name <email@domain>"` or
 * a bare address (see .env.example) — this pulls just the address back out,
 * so it can double as a fallback contact channel without a second real
 * mailbox needing to exist. Returns null for anything that doesn't look
 * like an email, rather than guessing.
 */
function extractEmailAddress(fromHeader: string | undefined): string | null {
  if (!fromHeader) return null;
  const angleMatch = fromHeader.match(/<([^>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : fromHeader).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function trimmedEnv(name: string): string | null {
  const value = process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Sale-Ready Phase D, D2 (Platform Configuration — Branding). The
 * platform's own visual identity, deliberately in this same module
 * rather than a second configuration system — "what is this platform
 * called" is one fact with one source, not something Branding and Legal
 * each get to answer independently. PLATFORM_NAME is that source: falls
 * back to the existing hardcoded siteConfig.name (zero-config deployments
 * are unchanged), and getPlatformLegalConfig()'s own legalName below now
 * falls back through this function instead of reading siteConfig.name
 * directly — one extra hop in the chain, not a second fact.
 */
export function getPlatformBranding(): PlatformBranding {
  return {
    name: trimmedEnv("PLATFORM_NAME") ?? siteConfig.name,
    tagline: trimmedEnv("PLATFORM_TAGLINE") ?? siteConfig.description,
    logoUrl: trimmedEnv("PLATFORM_LOGO_URL"),
    faviconUrl: trimmedEnv("PLATFORM_FAVICON_URL"),
  };
}

/**
 * Platform-level legal identity, deliberately separate from
 * OrganizationProfile (per-tenant business identity — see Business
 * Identity, Sale-Ready Phase A.1). This describes the ONE operator running
 * this Service for every tenant, not any single customer's own business —
 * it must never read Organization/OrganizationProfile data.
 *
 * Every field degrades to a safe, honest fallback rather than inventing
 * unverified information (a fabricated address or support mailbox would be
 * worse than omitting it) — callers (the /privacy and /terms pages, the
 * Footer, and the transactional email footer) render conditionally around
 * the null cases instead of assuming a value.
 */
export function getPlatformLegalConfig(): PlatformLegalConfig {
  return {
    legalName: trimmedEnv("PLATFORM_LEGAL_NAME") ?? getPlatformBranding().name,
    legalAddress: trimmedEnv("PLATFORM_LEGAL_ADDRESS"),
    supportEmail: trimmedEnv("PLATFORM_SUPPORT_EMAIL") ?? extractEmailAddress(process.env.INVITATION_FROM_EMAIL),
    jurisdiction: trimmedEnv("PLATFORM_JURISDICTION") ?? "the jurisdiction in which the Service operator is located",
    privacyEffectiveDate: trimmedEnv("PRIVACY_POLICY_EFFECTIVE_DATE") ?? "August 9, 2026",
    tosEffectiveDate: trimmedEnv("TOS_EFFECTIVE_DATE") ?? "August 9, 2026",
  };
}

/**
 * Sale-Ready Phase D, D3 (Platform Configuration — Email Configuration).
 * Read-only status of the platform's outbound email setup — never sends
 * anything, never calls Resend, never validates SMTP; purely reflects
 * what's already configured via existing env vars (RESEND_API_KEY,
 * INVITATION_FROM_EMAIL — both already read by src/lib/email/resend-
 * client.ts and callers) plus two new, display-only ones. supportEmail
 * reuses getPlatformLegalConfig()'s own value rather than re-deriving it
 * — one support mailbox, one source, same discipline PR2 established for
 * PLATFORM_NAME.
 */
export function getPlatformEmailConfig(): PlatformEmailConfig {
  const senderEmail = extractEmailAddress(process.env.INVITATION_FROM_EMAIL);
  const explicitReplyTo = trimmedEnv("PLATFORM_REPLY_TO_EMAIL");

  return {
    supportEmail: getPlatformLegalConfig().supportEmail,
    billingEmail: trimmedEnv("PLATFORM_BILLING_EMAIL"),
    senderEmail,
    replyToEmail: explicitReplyTo ?? senderEmail,
    providerName: "Resend",
    providerConfigured: trimmedEnv("RESEND_API_KEY") !== null,
    senderConfigured: senderEmail !== null,
    replyToConfigured: explicitReplyTo !== null,
  };
}
