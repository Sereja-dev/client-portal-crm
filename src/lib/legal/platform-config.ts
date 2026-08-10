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
