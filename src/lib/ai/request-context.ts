import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";
import { isOrganizationSuspended } from "@/lib/organization-access";
import { isPlatformAdmin } from "@/lib/platform-admin/authorization";

/**
 * AI Assistant Batch 1A. Modeled directly on
 * src/lib/search/request-context.ts's own getSearchRequestContext() —
 * the established, redirect-free, non-provisioning pattern for a JSON/
 * streaming API a browser's own JS calls directly, as opposed to a page.
 * See that module's own doc comment for the full "why not
 * getOrCreateUser()/getCurrentUserOrganization()/getCurrentMembership()"
 * reasoning, which applies identically here: every one of those either
 * redirect()s (meaningless to a fetch()/stream caller) or auto-provisions
 * a brand-new User/Organization/Membership on first contact (wrong for an
 * endpoint a chat keystroke could reach).
 *
 * Resolution order:
 *   1. No Supabase session at all                              -> 401
 *   2. A session whose email is on the Platform Admin allowlist -> 403,
 *      unconditionally, before any staff/Portal lookup runs at all (see
 *      the Platform Admin exclusion note below)
 *   3. A session, but no staff User row for it                  -> 403
 *      (covers both a Portal-only identity and a completely unknown one —
 *      deliberately never distinguished in the response, matching
 *      getSearchRequestContext's own "never leak which case occurred"
 *      discipline)
 *   4. A session with a staff User row, but no usable (non-suspended)
 *      Membership resolves                                       -> 403
 *   5. A session with a staff User row and a usable Membership    -> ok,
 *      with { userId, organizationId, role }
 *
 * Platform Admin exclusion (Batch 1A explicit requirement): checked via
 * isPlatformAdmin(authUser.email) — the exact same pure, exported
 * predicate src/lib/platform-admin/authorization.ts's own
 * requirePlatformAdmin() is built on — reused directly rather than
 * re-reading PLATFORM_ADMIN_EMAILS a second time in this module (which
 * would duplicate, not just reuse, the allowlist parsing this app treats
 * as sensitive operator configuration). This is a structural, unconditional
 * exclusion: it runs BEFORE any User/Membership lookup, so an identity
 * that is *both* on the Platform Admin allowlist *and* happens to also
 * have a real staff User/Membership row (a dual-identity edge case this
 * module's own integration tests exercise directly — see
 * test/integration/ai/request-context.test.ts) is denied on the Platform
 * Admin check alone, never reaching (and never benefiting from) the staff
 * resolution path below. The response is the same generic { ok: false,
 * status: 403 } as every other denial here — never a distinct status,
 * message, or shape that would let a caller infer "you were denied
 * specifically because you're a Platform Admin."
 *
 * organizationId is resolved here, server-side, from the caller's own
 * Membership row — never accepted as an argument by this function, and
 * (by construction, since nothing calls this with a parameter) never
 * derived from anything a client, and later an AI provider's tool-call
 * output, could influence.
 */

const ACTIVE_ORG_COOKIE = "active_organization_id";

export type AiAssistantRequestContext =
  | { ok: true; userId: string; organizationId: string; role: Role }
  | { ok: false; status: 401 | 403 };

/**
 * Read-only mirror of resolveOrganizationMembership() in
 * src/lib/search/request-context.ts — same cookie-then-Membership
 * fallback order, same "non-suspended only" filter, same "never
 * auto-provision" contract. Intentionally re-implemented here rather than
 * imported: that function is a private (non-exported) implementation
 * detail of the search module, and duplicating this small, already-proven
 * shape keeps the AI foundation independently auditable without creating
 * a cross-feature coupling between Search and AI Assistant.
 */
async function resolveOrganizationMembership(
  userId: string,
): Promise<{ organizationId: string; role: Role } | null> {
  const cookieStore = await cookies();
  const requestedOrganizationId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  if (requestedOrganizationId) {
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: requestedOrganizationId } },
      select: { organizationId: true, role: true, organization: { select: { suspendedAt: true } } },
    });
    if (membership && !isOrganizationSuspended(membership.organization)) {
      return { organizationId: membership.organizationId, role: membership.role };
    }
  }

  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { organizationId: true, role: true, createdAt: true, organization: { select: { suspendedAt: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  const usable = memberships.find((m) => !isOrganizationSuspended(m.organization));
  return usable ? { organizationId: usable.organizationId, role: usable.role } : null;
}

export async function getAiAssistantRequestContext(): Promise<AiAssistantRequestContext> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return { ok: false, status: 401 };
  }

  // Platform Admin exclusion — unconditional, checked before any staff
  // lookup. See this module's own header comment for why this must run
  // first, not merely "usually" work because Platform Admin identities
  // typically have no staff row.
  if (isPlatformAdmin(authUser.email)) {
    return { ok: false, status: 403 };
  }

  const user = await prisma.user.findUnique({ where: { id: authUser.id }, select: { id: true } });
  if (!user) {
    return { ok: false, status: 403 };
  }

  const membership = await resolveOrganizationMembership(user.id);
  if (!membership) {
    return { ok: false, status: 403 };
  }

  return { ok: true, userId: user.id, organizationId: membership.organizationId, role: membership.role };
}
