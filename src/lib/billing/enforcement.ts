import { prisma } from "@/lib/prisma";
import { getOrganizationEntitlements, type EntitlementReasonCode } from "./entitlements";
import type { PrismaClientOrTx } from "./usage";

/**
 * Billing & Subscriptions Stage 2 (docs/billing-architecture.md §11/§13's
 * error contract). The one, typed, controlled domain error every
 * enforcement helper below throws — never a raw Prisma error, never a
 * provider error, never anything that reveals database/provider internals.
 * `message` is always one of the fixed, generic, user-facing strings in
 * REASON_MESSAGES — safe to show directly in a form's existing error UI
 * with no further sanitization.
 */
export class BillingLimitError extends Error {
  readonly reasonCode: EntitlementReasonCode;

  constructor(reasonCode: EntitlementReasonCode) {
    super(REASON_MESSAGES[reasonCode]);
    this.name = "BillingLimitError";
    this.reasonCode = reasonCode;
  }
}

/**
 * Deliberately generic and provider-silent (docs/billing-architecture.md
 * §13's error contract): never a provider status, never a provider
 * customer/subscription id, never a price id, never a raw counter beyond
 * what the calling UI already asked for, never a database error message.
 */
export const REASON_MESSAGES: Readonly<Record<EntitlementReasonCode, string>> = {
  MEMBER_LIMIT_REACHED: "Your plan's member limit has been reached.",
  CLIENT_LIMIT_REACHED: "Your plan's client limit has been reached.",
  PROJECT_LIMIT_REACHED: "Your plan's project limit has been reached.",
  ACTIVE_PROJECT_LIMIT_REACHED:
    "Your plan's active-project limit has been reached. Complete or cancel an existing active project before activating another.",
  STORAGE_LIMIT_REACHED: "Your storage limit has been reached.",
  READ_ONLY_ACCESS: "Your subscription currently allows read-only access.",
} as const;

/**
 * Every assert* helper below:
 *   - takes a server-resolved organizationId only (never client input —
 *     every call site resolves it via getCurrentUserOrganization()/
 *     getCurrentMembership() before calling this, docs/billing-
 *     architecture.md §15's "no client-supplied organizationId" rule);
 *   - accepts an explicit Prisma client (default: the app singleton) so a
 *     caller can pass its own `tx` for an atomic re-check immediately
 *     before the write it's guarding — see each helper's own doc comment
 *     for its concurrency guarantee;
 *   - throws BillingLimitError (never returns a boolean) so a call site
 *     that forgets to check a return value fails loudly instead of
 *     silently allowing an over-limit write;
 *   - never trusts a client-supplied plan/status/usage number — every
 *     value comes from getOrganizationEntitlements()'s own DB-backed read.
 */

/**
 * Concurrency correction (confirmed race, see test/integration/billing/
 * free-plan-concurrency-corrections.test.ts's deterministic, barrier-
 * synchronized reproduction): under Postgres's default read-committed
 * isolation, a plain "count, then write" check has NO protection against
 * two concurrent transactions both reading the same pre-write count and
 * both committing — this is not a narrow edge case, it is the normal,
 * reliably-reproducible outcome whenever two requests' reads genuinely
 * overlap, and the previous doc comment here (accepting it as a
 * documented trade-off) UNDERSTATED the risk by describing it only as a
 * narrow residual gap.
 *
 * `pg_advisory_xact_lock`, keyed per (organizationId, dimension), is the
 * actual fix — the same technique, and the same underlying race class,
 * src/lib/permissions/management.ts's own acquireRolePermissionLock
 * already established and documents in full for RolePermissionOverride
 * saves. Acquired as this function's FIRST statement, inside the
 * caller's own transaction (every real call site already passes its own
 * `tx` — see each call site). Transaction-scoped (`_xact_`) — released
 * automatically on commit OR rollback, never leaked, no manual unlock to
 * forget. With this lock held, a second concurrent call for the SAME
 * organization and dimension blocks until the first transaction fully
 * commits or rolls back, so its own entitlements read (taken AFTER
 * acquiring the lock) always observes the first call's already-committed
 * outcome — at most one of two callers racing for the last remaining
 * slot can ever see "under the limit" and proceed to write.
 */
async function lockOrganizationForCapacityCheck(
  client: PrismaClientOrTx,
  organizationId: string,
  dimension: "members" | "clients" | "active-projects",
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId} || ':' || ${dimension}, 0))`;
}

export async function assertCanInviteMember(
  organizationId: string,
  client: PrismaClientOrTx = prisma,
): Promise<void> {
  await lockOrganizationForCapacityCheck(client, organizationId, "members");
  const entitlements = await getOrganizationEntitlements(organizationId, { client });
  if (entitlements.canInviteMember) return;
  throw new BillingLimitError(
    entitlements.accessMode !== "FULL_ACCESS" ? "READ_ONLY_ACCESS" : "MEMBER_LIMIT_REACHED",
  );
}

/** Same advisory-lock protection as assertCanInviteMember above, guarding the Client `create` in createClientCore's own transaction — shared by every client-creation entry point (interactive create, lead conversion, CSV import), since all three funnel through that one chokepoint. */
export async function assertCanCreateClient(
  organizationId: string,
  client: PrismaClientOrTx = prisma,
): Promise<void> {
  await lockOrganizationForCapacityCheck(client, organizationId, "clients");
  const entitlements = await getOrganizationEntitlements(organizationId, { client });
  if (entitlements.canCreateClient) return;
  throw new BillingLimitError(
    entitlements.accessMode !== "FULL_ACCESS" ? "READ_ONLY_ACCESS" : "CLIENT_LIMIT_REACHED",
  );
}

/**
 * Guards the plan-wide total-project ceiling (`maxProjects`) — `null`,
 * and therefore never actually enforced, for the Free plan itself (its
 * only project-related rule is the narrower `maxActiveProjects` dimension
 * assertCanIncreaseActiveProjects guards instead). Deliberately NOT given
 * the same `lockOrganizationForCapacityCheck` protection as its three
 * siblings above and below: the Free-plan correction task this function
 * was audited under is explicitly scoped to the 4 owner-approved Free
 * limits (2 staff, 25 clients, 5 active projects, 1 GiB storage), and
 * `maxProjects` is not one of them for FREE. The identical, now-confirmed
 * race almost certainly still applies here too, for the one real plan
 * that DOES set a finite `maxProjects` (STARTER: 20) — left unfixed and
 * explicitly flagged, rather than silently expanding this correction's
 * scope to a dimension outside the Free plan's own rules.
 */
export async function assertCanCreateProject(
  organizationId: string,
  client: PrismaClientOrTx = prisma,
): Promise<void> {
  const entitlements = await getOrganizationEntitlements(organizationId, { client });
  if (entitlements.canCreateProject) return;
  throw new BillingLimitError(
    entitlements.accessMode !== "FULL_ACCESS" ? "READ_ONLY_ACCESS" : "PROJECT_LIMIT_REACHED",
  );
}

/**
 * Aqenra Free plan's own active-project dimension — distinct from
 * assertCanCreateProject above, which only ever guards the (plan-wide,
 * currently unused by FREE) total-project ceiling. A caller must call
 * this ONLY when the write it guards would actually increase the active
 * count — i.e. the project's resolved target status counts toward the
 * limit (resolveProjectCountsTowardActiveLimit /
 * resolveProjectCountsTowardActiveLimit-equivalent check at the call
 * site) AND, for an update, its *previous* status did not already count.
 * Creating or editing a project into a COMPLETED/CANCELLED status, or
 * between two already-active statuses, never needs this check — see
 * src/app/(dashboard)/projects/new/actions.ts and
 * src/app/(dashboard)/projects/[id]/edit/actions.ts for the exact call
 * sites and their own before/after reasoning.
 *
 * Concurrency correction: same `lockOrganizationForCapacityCheck`
 * protection as assertCanInviteMember/assertCanCreateClient above, keyed
 * "active-projects" — shared with, and acquired the identical way by,
 * updateCustomStatusDefinition's own reclassification guard (src/lib/
 * custom-statuses/definitions.ts), since both compete for the exact same
 * resource: an organization's remaining active-project slots. Without
 * sharing this lock key, a concurrent project reactivation (through this
 * function) and a concurrent status reclassification (through its own
 * separate check) could each independently observe "one slot free" and
 * each proceed — one reactivating a single project, the other
 * reclassifying a whole status's worth of projects at once — together
 * exceeding the limit despite neither call, on its own, ever seeing an
 * over-limit state. Sharing the lock key serializes the two call sites
 * against EACH OTHER too, not just against themselves.
 */
export async function assertCanIncreaseActiveProjects(
  organizationId: string,
  client: PrismaClientOrTx = prisma,
): Promise<void> {
  await lockOrganizationForCapacityCheck(client, organizationId, "active-projects");
  const entitlements = await getOrganizationEntitlements(organizationId, { client });
  if (entitlements.canIncreaseActiveProjects) return;
  throw new BillingLimitError(
    entitlements.accessMode !== "FULL_ACCESS" ? "READ_ONLY_ACCESS" : "ACTIVE_PROJECT_LIMIT_REACHED",
  );
}

/**
 * Exposed so updateCustomStatusDefinition (src/lib/custom-statuses/
 * definitions.ts) can acquire the exact same "active-projects" lock
 * before its own bulk reclassification check — see
 * assertCanIncreaseActiveProjects's own doc comment immediately above
 * for why the two must share one lock key, not just the same mechanism.
 */
export async function lockOrganizationActiveProjectsForReclassification(
  client: PrismaClientOrTx,
  organizationId: string,
): Promise<void> {
  await lockOrganizationForCapacityCheck(client, organizationId, "active-projects");
}

/**
 * A plain, unlocked, point-in-time read — deliberately NOT the function
 * that actually gates the real upload path anymore. Confirmed (see
 * test/integration/billing/free-plan-concurrency-corrections.test.ts): two
 * near-simultaneous uploads that each individually fit under the quota,
 * but not both together, could both pass a check shaped exactly like this
 * one and both land, because nothing serializes the check against the
 * real Storage write that follows it. The actual fix —
 * src/lib/billing/storage-reservation.ts's reserveStorageBytes, a
 * per-organization-locked, short-lived DB reservation taken BEFORE the
 * slow external Storage call — is what uploadAttachmentForEntity (src/lib/
 * attachments/attachment-mutations.ts) and uploadOrganizationLogo
 * (src/lib/organization-setup/logo-mutations.ts) actually call today.
 * This function is kept only as a lightweight, non-authoritative
 * pre-check a caller may still want for an early, race-prone "does this
 * even plausibly fit" read (e.g. a UI hint) — never a substitute for
 * reserveStorageBytes on any path that actually writes.
 */
export async function assertCanUploadAttachment(
  organizationId: string,
  sizeBytes: number,
  client: PrismaClientOrTx = prisma,
): Promise<void> {
  const entitlements = await getOrganizationEntitlements(organizationId, { client });
  if (entitlements.canUploadBytes(sizeBytes)) return;
  throw new BillingLimitError(
    entitlements.accessMode !== "FULL_ACCESS" ? "READ_ONLY_ACCESS" : "STORAGE_LIMIT_REACHED",
  );
}
