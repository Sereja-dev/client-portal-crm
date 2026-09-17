import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { CalendarEventTargetType } from "./validation";

/**
 * Calendar V1 — the target invariant (LOCKED, task spec §3), mirroring
 * src/lib/contracts/target.ts's own resolveContractTarget() shape:
 * never trusts that a submitted id actually belongs to the caller's own
 * organization, or is currently selectable, just because it passed
 * format validation in validation.ts — this is the real authorization
 * boundary.
 *
 * Structurally, at most one of Client/Lead/Project can ever be supplied
 * here at all: the parameter is one `{ type, id }` pair (mirroring
 * validation.ts's own single `targetType`+`targetId` shape), never three
 * independent optional ids — so "a malicious caller sends multiple ids"
 * has no code path to even construct in the first place, not merely a
 * runtime check that happens to reject it. A foreign/nonexistent/
 * newly-archived target all collapse to the identical "invalid_target"
 * result — never a distinguishable response that could be used as an
 * existence oracle for another organization's data.
 */

export type ResolvedCalendarEventTarget = { clientId: string | null; leadId: string | null; projectId: string | null };

export type ResolveCalendarEventTargetResult =
  | { ok: true; target: ResolvedCalendarEventTarget }
  | { ok: false; reason: "invalid_target" };

/**
 * `previous` is the target already stored on the row being updated (null
 * for a brand-new create). When the caller's requested target is exactly
 * the same as `previous`, the archived/existence check is skipped
 * entirely — an already-selected Client/Lead can legitimately become
 * archived later without retroactively invalidating the event that
 * already references it (locked architecture §3: "may remain visible as
 * historical relation on an existing event"). Only a genuinely NEW
 * selection (creating fresh, or changing to a different target) must
 * pass the live non-archived check below.
 */
export async function resolveCalendarEventTarget(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  requested: { type: CalendarEventTargetType; id: string | null },
  previous: ResolvedCalendarEventTarget | null,
): Promise<ResolveCalendarEventTargetResult> {
  const empty: ResolvedCalendarEventTarget = { clientId: null, leadId: null, projectId: null };

  if (requested.type === "NONE" || requested.id === null) {
    return { ok: true, target: empty };
  }

  const previousId =
    requested.type === "CLIENT" ? previous?.clientId : requested.type === "LEAD" ? previous?.leadId : previous?.projectId;
  const unchanged = previous !== null && previousId === requested.id;

  if (requested.type === "CLIENT") {
    const row = await client.client.findFirst({
      where: unchanged
        ? { id: requested.id, organizationId }
        : { id: requested.id, organizationId, status: { not: "ARCHIVED" } },
      select: { id: true },
    });
    if (!row) return { ok: false, reason: "invalid_target" };
    return { ok: true, target: { ...empty, clientId: row.id } };
  }

  if (requested.type === "LEAD") {
    const row = await client.lead.findFirst({
      where: unchanged
        ? { id: requested.id, organizationId }
        : { id: requested.id, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!row) return { ok: false, reason: "invalid_target" };
    return { ok: true, target: { ...empty, leadId: row.id } };
  }

  // PROJECT -- no archive concept exists on this model at all (confirmed
  // by direct schema inspection: Project has `status`, no `archivedAt`),
  // so there is nothing beyond organization scoping to re-check here
  // regardless of whether this is a new or unchanged selection.
  const row = await client.project.findFirst({
    where: { id: requested.id, organizationId },
    select: { id: true },
  });
  if (!row) return { ok: false, reason: "invalid_target" };
  return { ok: true, target: { ...empty, projectId: row.id } };
}

export type ResolveCalendarEventAssigneeResult =
  | { ok: true; assignedToUserId: string | null }
  | { ok: false; reason: "invalid_assignee" };

/**
 * A raw User id existing globally is never proof it may be assigned —
 * this always re-verifies a CURRENT Membership in this exact
 * organization (locked architecture §4/§24: "Do NOT trust a raw User id
 * merely because that User exists globally"). Same unchanged-target
 * skip as resolveCalendarEventTarget above: an assignee who has since
 * left the organization (their Membership row removed) remains valid
 * historical context on an event that already names them, but can never
 * be NEWLY selected or re-confirmed once removed.
 */
export async function resolveCalendarEventAssignee(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  requestedUserId: string | null,
  previousUserId: string | null,
): Promise<ResolveCalendarEventAssigneeResult> {
  if (requestedUserId === null) {
    return { ok: true, assignedToUserId: null };
  }

  if (requestedUserId === previousUserId) {
    return { ok: true, assignedToUserId: requestedUserId };
  }

  const membership = await client.membership.findFirst({
    where: { userId: requestedUserId, organizationId },
    select: { id: true },
  });
  if (!membership) return { ok: false, reason: "invalid_assignee" };
  return { ok: true, assignedToUserId: requestedUserId };
}
