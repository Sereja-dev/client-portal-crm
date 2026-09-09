import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getVerifiedAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { createTrialSubscription } from "@/lib/billing/provisioning";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { isOrganizationSuspended, ORGANIZATION_UNAVAILABLE_PATH } from "@/lib/organization-access";
import { seedThemeModeFromRequestCookie } from "@/lib/theme/request-cookie-seed";

const ACTIVE_ORG_COOKIE = "active_organization_id";
const ACTIVE_ORG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function activeOrgCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACTIVE_ORG_COOKIE_MAX_AGE,
  };
}

/**
 * Ensures a Prisma User row exists for the currently authenticated Supabase
 * user, using the Supabase auth user id as the Prisma User id. Called
 * independently from ~20 pages/actions with no shared request-level cache,
 * so on a first-ever login it's normal for several of these (e.g. Next.js
 * prefetching sidebar links) to race to create the same row concurrently.
 * If this call loses that race, the row now exists (created by the winner),
 * so we just read it back instead of surfacing the P2002.
 *
 * Guards against a Client Portal-only identity (a PortalUser with no staff
 * Membership) ever getting a User/Organization auto-provisioned. This must
 * live here, not only in (dashboard)/layout.tsx's guard, because Next.js
 * background prefetch requests for Sidebar links re-render Server
 * Components independently of whichever page the user is actually looking
 * at — a single guard higher up in the tree doesn't see those.
 */
export async function getOrCreateUser() {
  const authUser = await getVerifiedAuthUser();

  if (!authUser) {
    redirect("/login");
  }

  const existing = await prisma.user.findUnique({ where: { id: authUser.id } });
  if (existing) {
    return existing;
  }

  const portalUser = await prisma.portalUser.findUnique({
    where: { id: authUser.id },
    select: { id: true },
  });
  if (portalUser) {
    redirect("/portal");
  }

  // Aqenra Theme Persistence Phase C2. Read ONLY on this "no User row
  // exists yet" path, right before the one place a brand-new User is
  // ever created — an existing identity's own stored preference (read
  // above via `existing`, which already returned) must never be
  // overwritten by whatever this device's cookie currently says.
  const seededThemeMode = await seedThemeModeFromRequestCookie();

  try {
    return await prisma.user.upsert({
      where: { id: authUser.id },
      update: {},
      create: {
        id: authUser.id,
        email: authUser.email!,
        name: authUser.user_metadata?.name ?? authUser.email!.split("@")[0],
        themeMode: seededThemeMode,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.user.findUnique({
        where: { id: authUser.id },
      });
      if (existing) {
        return existing;
      }
    }
    throw err;
  }
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "org"
  );
}

async function uniqueOrganizationSlug(
  tx: Prisma.TransactionClient,
  base: string,
): Promise<string> {
  let candidate = base;
  let attempt = 1;
  while (await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
  return candidate;
}

type ProvisioningUser = { id: string; name: string; email: string };

/**
 * The one transaction body every getOrCreateOrganizationId() attempt runs
 * — extracted only so Stability Correction F1's bounded single retry
 * (below) can invoke the exact same logic a second time without
 * duplicating it, never changing what it does.
 */
async function createPersonalOrganizationAndMembership(
  user: ProvisioningUser,
  trimmedPreferredName: string | undefined,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.membership.findFirst({
      where: { userId: user.id, role: Role.OWNER },
      select: { organizationId: true },
    });
    if (existing) {
      return existing.organizationId;
    }

    const base = slugify(trimmedPreferredName || user.name) || slugify(user.email.split("@")[0]);
    const slug = await uniqueOrganizationSlug(tx, `${base}-${user.id.slice(0, 8)}`);
    const organization = await tx.organization.create({
      data: { name: trimmedPreferredName || `${user.name}'s Workspace`, slug },
    });
    await tx.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: Role.OWNER },
    });
    // Billing & Subscriptions Stage 2 (docs/billing-architecture.md §9):
    // every brand-new Organization gets a local TRIALING Subscription
    // row atomically alongside it — same transaction, so either both
    // exist or neither does.
    await createTrialSubscription(tx, organization.id, new Date());
    // Custom Statuses Phase 1 (Section N): every brand-new Organization
    // must get the full set of built-in system status definitions for
    // CLIENT/LEAD/PROJECT, atomically alongside it — same transaction, so
    // no organization can ever be created without them. Existing
    // organizations are backfilled by this feature's own migration
    // instead (Section O); this call only ever runs for organizations
    // created after this point in time.
    await bootstrapOrganizationStatusDefinitions(tx, organization.id);
    return organization.id;
  });
}

/**
 * Stability Correction F1 — recognizes, narrowly, the one specific FK
 * violation this module's own bounded retry (below) knows how to safely
 * recover from: `Membership.userId` referencing a User row that doesn't
 * exist at the exact moment `tx.membership.create()` runs (e.g. a
 * concurrently-deleted, or not-yet-created, User row for this identity —
 * every current caller derives `user` from getOrCreateUser()'s own
 * upsert, but time passes between that call and this transaction).
 *
 * Empirically confirmed shape (Prisma 7.9.1, `@prisma/adapter-pg`), via a
 * genuine reproduction against a real Postgres FK violation on this exact
 * constraint (a disposable, never-committed integration probe run during
 * this correction's own investigation, not carried into any test file):
 *   err.code === "P2003"
 *   err.meta.modelName === "Membership"
 *   err.meta.driverAdapterError.cause.constraint.index === "Membership_userId_fkey"
 *
 * A P2003 on any OTHER constraint (e.g. Membership_organizationId_fkey, or
 * a P2003 on a completely different model) is a different, NOT safely
 * retryable problem — it could mean the Organization itself is gone, a
 * genuine tenant/data inconsistency this function must never paper over
 * by retrying — so it is deliberately left unrecognized and falls through
 * to the same unconditional `throw err` every other unrecognized error
 * already does.
 */
export function isMembershipUserForeignKeyViolation(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2003") {
    return false;
  }
  const meta = err.meta;
  if (!meta || typeof meta !== "object" || meta.modelName !== "Membership") {
    return false;
  }
  const driverAdapterError = meta.driverAdapterError;
  if (!driverAdapterError || typeof driverAdapterError !== "object") {
    return false;
  }
  const cause = (driverAdapterError as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") {
    return false;
  }
  const constraint = (cause as { constraint?: unknown }).constraint;
  if (!constraint || typeof constraint !== "object") {
    return false;
  }
  return (constraint as { index?: unknown }).index === "Membership_userId_fkey";
}

/**
 * Resolves the organization the given user belongs to, using their OWNER
 * Membership as the source of truth (mirrors prisma/backfill-organizations.ts).
 * Users created before the multi-tenant backfill already have one; users
 * created afterwards need a personal org+membership created on the fly here,
 * so this stays idempotent and safe to call on every request.
 */
export async function getOrCreateOrganizationId(
  user: ProvisioningUser,
  /**
   * SaaS Signup Foundation (Stage 6.1): the company name a user typed on
   * `/signup`, when this is their very first organization — takes priority
   * over the generic "${user.name}'s Workspace" default below, both for the
   * created Organization's display name and for the slug's own base text.
   * Every other caller (the lazy first-dashboard-visit path, invited users,
   * every existing test) omits this and gets byte-identical behavior to
   * before — purely additive.
   */
  preferredName?: string,
): Promise<string> {
  const ownerMembership = await prisma.membership.findFirst({
    where: { userId: user.id, role: Role.OWNER },
    select: { organizationId: true },
  });

  if (ownerMembership) {
    return ownerMembership.organizationId;
  }

  const trimmedPreferredName = preferredName?.trim();

  try {
    return await createPersonalOrganizationAndMembership(user, trimmedPreferredName);
  } catch (err) {
    // Concurrent requests (e.g. prefetched pages) can race to create the
    // same user's personal org; the loser just reads back the winner's row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.membership.findFirst({
        where: { userId: user.id, role: Role.OWNER },
        select: { organizationId: true },
      });
      if (existing) {
        return existing.organizationId;
      }
    } else if (isMembershipUserForeignKeyViolation(err)) {
      // Stability Correction F1 — bounded, single recovery attempt: the
      // User row this transaction's own Membership insert depends on is
      // genuinely missing right now. Re-establish it using the exact same
      // idempotent upsert shape getOrCreateUser() already treats as this
      // app's trusted "ensure this identity's row exists" contract, then
      // retry the transaction exactly once. Any further failure — a
      // repeat P2003, or anything else — terminates here, deterministically,
      // through one bounded application error; it is never retried a
      // second time and the raw Prisma error is never surfaced.
      //
      // The one-tick yield below is not an artificial delay for observation
      // purposes — it is a deliberate, empirically-justified defensive
      // measure: this correction's own investigation found that reusing
      // this same connection for a new query in the same synchronous
      // continuation immediately after a transaction the driver aborted
      // (a real `@prisma/adapter-pg` behavior, reproduced directly against
      // this repo's own real PGlite-backed test Postgres) can race the
      // driver's own async connection-cleanup, occasionally handing the
      // next query a stale, wrongly-shaped buffered result instead of its
      // own. A single `setTimeout(0)` yield — proven sufficient, not an
      // arbitrary guess — lets that cleanup finish before this recovery
      // attempt reuses the connection.
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await prisma.user.upsert({
          where: { id: user.id },
          update: { email: user.email },
          create: { id: user.id, email: user.email, name: user.name },
        });
        const organizationId = await createPersonalOrganizationAndMembership(user, trimmedPreferredName);
        // Production Observability Correction 2 — a bounded, fixed,
        // zero-argument signal that this exact recovery genuinely
        // succeeded. Logged only here, once, after both the User-row
        // re-establishment and the retried transaction have already
        // succeeded — never before, never for an unrelated/unrecognized
        // P2003, and never on the failed-retry path below (which throws
        // before reaching this line). No user/organization/membership id,
        // error object, constraint metadata, retry count, or timing is
        // ever included — there is nothing here to log beyond the fact
        // that this happened at all.
        console.warn("[organization-provisioning] Membership FK race recovered.");
        return organizationId;
      } catch {
        throw new Error("Unable to set up your organization. Please try again.");
      }
    }
    throw err;
  }
}

/**
 * Resolves which organization the current request should operate against.
 *
 * Prefers the user's explicitly chosen "active organization" — persisted in
 * an httpOnly cookie purely as a UX preference — but only after confirming a
 * Membership row proves they still belong to it AND that organization is not
 * suspended; the cookie is never trusted as an authorization decision by
 * itself. Falls back to their OWNER organization (auto-provisioning one via
 * getOrCreateOrganizationId if this is their first time) when no cookie is
 * set, or when the cookie names an organization they're no longer (or never
 * were) a member of — so a user who has never switched keeps working exactly
 * as before this change.
 *
 * Platform Admin Organization Suspension, PR 1: when the cookie's own
 * organization is suspended, or absent, this now also checks every other
 * organization the user actually belongs to before ever reaching
 * getOrCreateOrganizationId() — a user with an existing membership (even a
 * suspended one) must never silently receive a brand-new auto-provisioned
 * personal organization; getOrCreateOrganizationId() below is only ever
 * reached once this function has independently confirmed the user has no
 * membership at all (the genuine first-time-user case, unchanged). A user
 * with another accessible, non-suspended organization is routed there
 * instead of being denied; only a user whose *every* real membership is
 * suspended is redirected to ORGANIZATION_UNAVAILABLE_PATH.
 */
async function resolveActiveOrganizationId(user: {
  id: string;
  name: string;
  email: string;
}): Promise<string> {
  const cookieStore = await cookies();
  const requestedOrganizationId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  if (requestedOrganizationId) {
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId: requestedOrganizationId },
      },
      select: { organizationId: true, organization: { select: { suspendedAt: true } } },
    });
    if (membership && !isOrganizationSuspended(membership.organization)) {
      return membership.organizationId;
    }
  }

  // The cookie was absent, stale, or named a now-suspended organization.
  // Before ever provisioning anything, look across every real membership
  // this user has — ordered OWNER first (Role's own declared enum order,
  // matching getOrCreateOrganizationId's own OWNER-priority default), then
  // oldest first — for the first one that is not suspended.
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    select: { organizationId: true, organization: { select: { suspendedAt: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  const usableMembership = memberships.find((m) => !isOrganizationSuspended(m.organization));
  if (usableMembership) {
    try {
      cookieStore.set(ACTIVE_ORG_COOKIE, usableMembership.organizationId, activeOrgCookieOptions());
    } catch {
      // Server Component context; see the try/catch below for the same
      // reasoning — the next request simply re-resolves the same default.
    }
    return usableMembership.organizationId;
  }

  if (memberships.length > 0) {
    // A real membership exists, but every one of them is suspended — a
    // hard, terminal denial. Deliberately never falls through to
    // getOrCreateOrganizationId() below, which would otherwise silently
    // auto-provision a brand-new personal organization for someone who
    // already has a real membership.
    redirect(ORGANIZATION_UNAVAILABLE_PATH);
  }

  const organizationId = await getOrCreateOrganizationId(user);
  try {
    // Stabilizes the resolved default for subsequent requests. Only takes
    // effect when called from a Server Action or Route Handler — thrown
    // (and ignored here) when called from a Server Component, same as the
    // Supabase cookie adapter's own setAll in lib/supabase/server.ts.
    cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, activeOrgCookieOptions());
  } catch {
    // Server Component context; the cookie simply isn't written yet — the
    // next request re-resolves the same default via getOrCreateOrganizationId.
  }
  return organizationId;
}

/**
 * Convenience wrapper for the common case: pages/actions that need both the
 * current User row and the active organizationId to scope queries by.
 */
export async function getCurrentUserOrganization() {
  const user = await getOrCreateUser();
  const organizationId = await resolveActiveOrganizationId(user);
  return { user, organizationId };
}

/**
 * Like getCurrentUserOrganization(), but also resolves the current user's
 * own Membership row in the active organization — needed by anything whose
 * behavior varies by role (e.g. who's allowed to invite members). The
 * lookup can't miss: resolveActiveOrganizationId() only ever returns an
 * organizationId backed by an existing Membership for this user.
 */
export async function getCurrentMembership() {
  const { user, organizationId } = await getCurrentUserOrganization();
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
  });

  if (!membership) {
    throw new Error("No membership found for the active organization.");
  }

  return { user, organizationId, membership };
}

/**
 * Switches the current user's active organization, after verifying they
 * actually hold a Membership there — callers must never set the cookie
 * directly. Must be called from a Server Action or Route Handler; cookies()
 * cannot be mutated from a Server Component.
 */
export async function setActiveOrganization(organizationId: string): Promise<void> {
  const user = await getOrCreateUser();
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    select: { organizationId: true },
  });

  if (!membership) {
    throw new Error("You are not a member of this organization.");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, membership.organizationId, activeOrgCookieOptions());
}

export type OrganizationSwitcherItem = {
  organizationId: string;
  name: string;
  slug: string;
  role: Role;
  isActive: boolean;
};

const ROLE_RANK: Record<Role, number> = {
  [Role.OWNER]: 0,
  [Role.ADMIN]: 1,
  [Role.MEMBER]: 2,
};

/**
 * Lists every organization the current user belongs to, for the
 * organization switcher — active organization first, then grouped by role
 * (OWNER, ADMIN, MEMBER), then alphabetically by name within each group.
 * Queried fresh on every call (no caching layer sits in front of this), so
 * a Membership removed a moment ago simply won't be in the result.
 */
export async function getOrganizationSwitcherItems(): Promise<
  OrganizationSwitcherItem[]
> {
  const { user, organizationId: activeOrganizationId } =
    await getCurrentUserOrganization();

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    select: {
      organizationId: true,
      role: true,
      organization: { select: { name: true, slug: true } },
    },
  });

  return memberships
    .map((m) => ({
      organizationId: m.organizationId,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
      isActive: m.organizationId === activeOrganizationId,
    }))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const roleDiff = ROLE_RANK[a.role] - ROLE_RANK[b.role];
      if (roleDiff !== 0) return roleDiff;
      return a.name.localeCompare(b.name);
    });
}
