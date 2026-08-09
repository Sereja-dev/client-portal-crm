import { siteConfig } from "@/config/site";

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
    legalName: trimmedEnv("PLATFORM_LEGAL_NAME") ?? siteConfig.name,
    legalAddress: trimmedEnv("PLATFORM_LEGAL_ADDRESS"),
    supportEmail: trimmedEnv("PLATFORM_SUPPORT_EMAIL") ?? extractEmailAddress(process.env.INVITATION_FROM_EMAIL),
    jurisdiction: trimmedEnv("PLATFORM_JURISDICTION") ?? "the jurisdiction in which the Service operator is located",
    privacyEffectiveDate: trimmedEnv("PRIVACY_POLICY_EFFECTIVE_DATE") ?? "August 9, 2026",
    tosEffectiveDate: trimmedEnv("TOS_EFFECTIVE_DATE") ?? "August 9, 2026",
  };
}
