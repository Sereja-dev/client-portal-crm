import "server-only";

/**
 * Free Public Beta, Slice 1 (Access + Billing Messaging). The one, single,
 * named predicate for "is Aqenra currently running as a free public beta
 * with trial/subscription enforcement suspended" — never a raw
 * `process.env.FREE_BETA_MODE` string check scattered across unrelated
 * files. Every pure billing calculation function this flag reaches
 * (buildOrganizationEntitlements, buildStatusNotice,
 * buildBillingPageViewModel, buildAvailablePlans) stays IO-free and takes
 * this as an explicit boolean parameter instead, mirroring exactly how
 * `providerConfigured` is already threaded through those same functions —
 * this helper is called exactly once per request, by the DB-backed
 * wrappers that already resolve other environment/provider facts the same
 * way (see getOrganizationEntitlements's own providerAvailability
 * resolution).
 *
 * Strict parsing: only the literal string "true" enables it — "1", "TRUE",
 * "yes", or any other truthy-looking value is treated as disabled, so a
 * typo or a differently-formatted CI/preview env value can never silently
 * enable free-beta access. Default (unset) is false.
 *
 * IMPORTANT OPERATIONAL INVARIANT — future paid launch safety: do NOT
 * simply flip this back to disabled once Paddle is introduced, without a
 * separately approved transition plan. Every organization's real
 * Subscription.status/trialEndsAt kept ticking in the database the whole
 * time this flag was on (see entitlements.ts's own override — it only
 * ever changes the *computed* accessMode, never writes a row), so an
 * organization that signed up during the beta and would, on a bare
 * calendar basis, already be well past its 14-day trial will become
 * READ_ONLY the instant this flag is disabled and a real billing
 * provider is configured — with no warning, no grace period, and no
 * communication to that user. Disabling this safely requires: Product
 * Owner approval, a defined transition policy (e.g. a fresh grace
 * period, a backfill of trialEndsAt, or a one-time migration to a paid-
 * launch-safe plan/status), advance user communication, and dedicated
 * testing against Production data shapes — none of which this flag
 * implements on its own. This module deliberately does nothing to
 * enforce or automate that transition; it is a pure, dumb on/off switch.
 */
export function isFreeBetaModeEnabled(): boolean {
  return process.env.FREE_BETA_MODE === "true";
}
