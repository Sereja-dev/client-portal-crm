"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { getCurrentUserOrganization, getCurrentMembership, setActiveOrganization } from "@/lib/current-user";
import { withToast } from "@/lib/toast-url";
import { checkRateLimit, START_SAMPLE_DATA_LIMIT } from "@/lib/rate-limit";
import { countExistingBusinessData, isWorkspaceEmpty, createSampleWorkspaceData } from "@/lib/onboarding/sample-data";

export async function signOut() {
  const supabase = await createClient();
  // Sign-out scope hardening: the installed Supabase Auth client defaults
  // signOut() to `scope: "global"` — revoking this user's refresh token on
  // EVERY device/browser they're signed in on, not just this one. A plain
  // "Sign out" button never promises that (no UI copy here says "all
  // devices"), and the installed library's own docs recommend `local` for
  // exactly this case. See the sign-out scope audit for the full analysis.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/**
 * Switches the current user's active organization. organizationId is
 * untrusted input (it comes straight from a switcher button click) —
 * setActiveOrganization() re-verifies a Membership row exists for
 * (user, organizationId) before touching the cookie, and throws the exact
 * same message whether the id belongs to someone else's organization or
 * doesn't exist at all, so neither case can be distinguished from outside.
 */
export async function switchOrganizationAction(organizationId: string): Promise<void> {
  await setActiveOrganization(organizationId);

  // Every dashboard route scopes its data by the active organization, so a
  // switch invalidates the whole layout subtree at once (and purges the
  // client router cache) rather than enumerating each affected route.
  revalidatePath("/", "layout");

  redirect(withToast("/dashboard", "Switched organization"));
}

/**
 * Marks one Notification read for the current staff user. Scoped by
 * {id, recipientId, organizationId} together — never by id alone — so a
 * crafted id belonging to someone else, or to another organization, simply
 * matches zero rows instead of erroring; that's indistinguishable from a
 * nonexistent id, which is the same "generic no-op" every other cross-
 * tenant mutation in this app already falls back to. `readAt: null` in the
 * WHERE makes a duplicate click idempotent — a no-op, not a second write.
 */
export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const { user, organizationId } = await getCurrentUserOrganization();

  await prisma.notification.updateMany({
    where: { id: notificationId, recipientId: user.id, organizationId, readAt: null },
    data: { readAt: new Date() },
  });

  // The bell/badge render in the layout itself, not a specific page — same
  // reasoning as switchOrganizationAction's own revalidation above.
  revalidatePath("/", "layout");
}

/** Bulk equivalent of markNotificationReadAction — same scoping, same idempotency. */
export async function markAllNotificationsReadAction(): Promise<void> {
  const { user, organizationId } = await getCurrentUserOrganization();

  await prisma.notification.updateMany({
    where: { recipientId: user.id, organizationId, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/", "layout");
}

export type StartWithSampleDataResult = { ok: true } | { ok: false; message: string };

const NOT_OWNER_MESSAGE = "Only the workspace owner can start with sample data.";
const ALREADY_DEMO_MESSAGE = "This workspace already has sample data.";
const NOT_EMPTY_MESSAGE = "Sample data can only be added to a brand-new, empty workspace.";
const SAMPLE_DATA_GENERIC_ERROR = "Unable to add sample data. Please try again.";

/**
 * Thrown only from inside the transaction below, for the two guard
 * conditions that must roll back everything (including the isDemo claim)
 * rather than partially apply — never surfaced past this file, never
 * confused with a genuine unexpected error (whose message must stay
 * generic, see the outer catch below).
 */
class StartWithSampleDataGuardError extends Error {}

/**
 * Demo Vs Real Workspace Separation §5-§8. organizationId/userId are never
 * accepted as parameters — both are resolved server-side via
 * getCurrentMembership(), the same discipline every other action in this
 * file already follows. OWNER-only (unlike src/lib/onboarding/actions.ts's
 * own deliberately role-agnostic skip/dismiss actions — this is a real,
 * consequential, irreversible-ish data-creation action, not a UI nudge,
 * so it lives here rather than there): ADMIN/MEMBER are rejected before
 * any query runs.
 *
 * Concurrency-safe against a double-click/retry by construction, not by
 * disabling a button: the transaction's FIRST statement is an atomic
 * `UPDATE ... WHERE isDemo = false` claim (the same "conditional
 * update-then-check" pattern this app's own invitation-acceptance flow
 * already established) — Postgres row-level locking guarantees at most one
 * concurrent call can ever see `count === 1` for a given organization, so
 * a second concurrent/retried call always loses the claim and is rejected
 * cleanly, never producing a duplicate dataset. Only once the claim
 * succeeds does this re-check emptiness (countExistingBusinessData/
 * isWorkspaceEmpty — the exact same four entity types: Clients, Projects,
 * Tasks, Invoices) INSIDE the same transaction; if the workspace turns out
 * not to be empty after all, this throws, which rolls back the isDemo
 * claim too — §8's own explicit invariant ("never leave demo=true with
 * missing sample data, or partial business records") is enforced by
 * Postgres's own transaction atomicity, not by a second cleanup step.
 * createSampleWorkspaceData() only ever runs once both guards have
 * passed inside this one transaction — the whole thing commits together
 * or not at all.
 */
export async function startWithSampleDataAction(): Promise<StartWithSampleDataResult> {
  const { user, organizationId, membership } = await getCurrentMembership();

  if (membership.role !== Role.OWNER) {
    return { ok: false, message: NOT_OWNER_MESSAGE };
  }

  const limitCheck = checkRateLimit(START_SAMPLE_DATA_LIMIT, user.id);
  if (limitCheck.limited) {
    return { ok: false, message: limitCheck.message };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.organization.updateMany({
        where: { id: organizationId, isDemo: false },
        data: { isDemo: true },
      });
      if (claimed.count !== 1) {
        throw new StartWithSampleDataGuardError(ALREADY_DEMO_MESSAGE);
      }

      const counts = await countExistingBusinessData(tx, organizationId);
      if (!isWorkspaceEmpty(counts)) {
        throw new StartWithSampleDataGuardError(NOT_EMPTY_MESSAGE);
      }

      await createSampleWorkspaceData(tx, { organizationId, ownerId: user.id });
    });
  } catch (err) {
    if (err instanceof StartWithSampleDataGuardError) {
      return { ok: false, message: err.message };
    }
    // Never the raw error/message — mirrors every other action's own
    // generic-failure posture in this app.
    return { ok: false, message: SAMPLE_DATA_GENERIC_ERROR };
  }

  // The demo banner lives in the layout, and the Dashboard's own eligibility
  // check/OnboardingCard-adjacent prompt both need fresh data — same
  // whole-layout invalidation switchOrganizationAction already uses above.
  revalidatePath("/", "layout");
  return { ok: true };
}
