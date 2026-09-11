import "server-only";
import type { ClientRequest } from "@/generated/prisma/client";
import type { ClientRequestPriority } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { createActivity } from "@/lib/activity/create-activity";
import { buildClientRequestActivityMetadata, buildClientRequestStatusChangeMetadata } from "@/lib/activity/client-request-metadata";
import {
  isClientRequestStatus,
  isClientRequestPriority,
  deriveClientRequestResolvedAt,
  type ClientRequestStatusValue,
} from "@/lib/validation/client-request";

/**
 * Client Requests / Tickets, Phase 1 — Staff domain layer. Every function
 * here is organization-scoped exactly like Custom Statuses'/Custom
 * Fields'/Lead Capture Forms' own definitions.ts: a foreign-org id is
 * always treated as nonexistent, never a distinguishable "exists but
 * denied" case. Callers resolve `organizationId` (and, where a mutation
 * needs an Activity actor, the authenticated staff member's own {id,
 * name}) from an authenticated session themselves — no Server Action
 * layer exists yet in this phase (foundation-first; see this feature's
 * own report for why), so these are called directly from integration
 * tests today, the same way Custom Statuses Phase 1's own domain layer
 * was.
 *
 * Staff-created tickets (a Staff member filing a request on a Client's
 * behalf, with no Portal author) are DEFERRED — not implemented here.
 * createPortalClientRequest (portal.ts) is the only create path in this
 * phase; widening it to a Staff-facing create function would mean a
 * second clientId-trust boundary (verifying a Staff-supplied clientId
 * belongs to their own organization, distinct from Portal's own "derived
 * from session, never accepted as input" rule) that the approved Phase 1
 * spec does not ask for and that adds real surface area for a phase
 * whose whole point is staying minimal. A future phase can add it
 * without changing anything here.
 */

export type ClientRequestActor = { id: string; name: string };

export type ClientRequestMutationResult = { ok: true; request: ClientRequest } | { ok: false; reason: "REQUEST_NOT_FOUND" };

/**
 * Phase 2A: list/get below now also join client.name/assignedTo.name/
 * project.name/portalUser.name — display data only (names are never
 * secrets), needed so the Staff list/detail UI can show real identities
 * without N+1 round trips. Purely additive: every existing scalar field
 * these functions already returned is untouched, and this changes
 * nothing about scoping/authorization.
 */
const REQUEST_DISPLAY_INCLUDE = {
  client: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  portalUser: { select: { id: true, name: true } },
} as const;

export type ClientRequestWithDisplay = ClientRequest & {
  client: { id: string; name: string };
  assignedTo: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  portalUser: { id: string; name: string } | null;
};

/** Phase 2A adds `priority`/`assignedToId` filters alongside the existing `clientId`/`status` ones, for the Staff list page's own simple filter bar. */
export async function listOrganizationClientRequests(
  organizationId: string,
  options: {
    includeArchived?: boolean;
    clientId?: string;
    status?: ClientRequestStatusValue;
    priority?: ClientRequestPriority;
    assignedToId?: string;
  } = {},
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestWithDisplay[]> {
  return client.clientRequest.findMany({
    where: {
      organizationId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.priority ? { priority: options.priority } : {}),
      ...(options.assignedToId ? { assignedToId: options.assignedToId } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    include: REQUEST_DISPLAY_INCLUDE,
  });
}

export async function getOrganizationClientRequest(
  organizationId: string,
  requestId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestWithDisplay | null> {
  return client.clientRequest.findFirst({ where: { id: requestId, organizationId }, include: REQUEST_DISPLAY_INCLUDE });
}

/**
 * Every status -> status transition is allowed in V1 — no state machine,
 * no blocked transitions. "RESOLVED: still reopenable if product
 * semantics allow" and CLOSED being "terminal/administrative" (per this
 * phase's own spec) both describe intended USAGE, not an enforced
 * restriction: nothing in this phase's approved design calls for
 * rejecting e.g. CLOSED -> OPEN, and inventing one now would be exactly
 * the kind of automation/workflow-rule scope this phase explicitly
 * excludes. resolvedAt bookkeeping (see deriveClientRequestResolvedAt)
 * is the only side effect a status change has.
 */
export async function updateClientRequestStatus(
  organizationId: string,
  requestId: string,
  status: unknown,
  actor: ClientRequestActor,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestMutationResult | { ok: false; reason: "INVALID_STATUS" }> {
  if (!isClientRequestStatus(status)) {
    return { ok: false, reason: "INVALID_STATUS" };
  }

  const existing = await client.clientRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }

  if (existing.status === status) {
    return { ok: true, request: existing };
  }

  const runUpdate = async (tx: PrismaClientOrTx) => {
    const updated = await tx.clientRequest.update({
      where: { id: requestId },
      data: { status, resolvedAt: deriveClientRequestResolvedAt(status, existing.resolvedAt) },
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "CLIENT_REQUEST",
      entityId: requestId,
      action: "STATUS_CHANGED",
      metadata: buildClientRequestStatusChangeMetadata(existing.status, status),
    });

    return updated;
  };

  const request = client === prisma ? await prisma.$transaction((tx) => runUpdate(tx)) : await runUpdate(client);
  return { ok: true, request };
}

export async function updateClientRequestPriority(
  organizationId: string,
  requestId: string,
  priority: unknown,
  actor: ClientRequestActor,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestMutationResult | { ok: false; reason: "INVALID_PRIORITY" }> {
  if (!isClientRequestPriority(priority)) {
    return { ok: false, reason: "INVALID_PRIORITY" };
  }

  const existing = await client.clientRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }

  if (existing.priority === priority) {
    return { ok: true, request: existing };
  }

  const runUpdate = async (tx: PrismaClientOrTx) => {
    const updated = await tx.clientRequest.update({ where: { id: requestId }, data: { priority } });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "CLIENT_REQUEST",
      entityId: requestId,
      action: "UPDATED",
      metadata: buildClientRequestActivityMetadata(updated, actor.name, ["priority"]),
    });

    return updated;
  };

  const request = client === prisma ? await prisma.$transaction((tx) => runUpdate(tx)) : await runUpdate(client);
  return { ok: true, request };
}

/** Verifies `userId` holds a real Membership in `organizationId` — same pattern createLeadAction's own verifyAssigneeInOrganization uses. Exported for messages.ts's own identical "Staff author must belong to request Organization" check. */
export async function verifyMembership(userId: string, organizationId: string, client: PrismaClientOrTx): Promise<boolean> {
  const membership = await client.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { userId: true },
  });
  return membership !== null;
}

/** `assignedToId: null` unassigns. A non-null value is rejected unless it holds a real Membership in this same organizationId — never trusted from caller input. */
export async function assignClientRequest(
  organizationId: string,
  requestId: string,
  assignedToId: string | null,
  actor: ClientRequestActor,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestMutationResult | { ok: false; reason: "INVALID_ASSIGNEE" }> {
  const existing = await client.clientRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }

  if (assignedToId && !(await verifyMembership(assignedToId, organizationId, client))) {
    return { ok: false, reason: "INVALID_ASSIGNEE" };
  }

  if (existing.assignedToId === assignedToId) {
    return { ok: true, request: existing };
  }

  const runUpdate = async (tx: PrismaClientOrTx) => {
    const updated = await tx.clientRequest.update({ where: { id: requestId }, data: { assignedToId } });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "CLIENT_REQUEST",
      entityId: requestId,
      action: "UPDATED",
      metadata: buildClientRequestActivityMetadata(updated, actor.name, ["assignedToId"]),
    });

    return updated;
  };

  const request = client === prisma ? await prisma.$transaction((tx) => runUpdate(tx)) : await runUpdate(client);
  return { ok: true, request };
}

/**
 * `projectId: null` unlinks. A non-null value is rejected unless the
 * Project belongs to BOTH this same organizationId AND this exact
 * request's own clientId — a Project from a different Client in the
 * same organization is just as invalid as one from a different
 * organization entirely (Section: "Project must match both Organization
 * and Client").
 */
export async function linkClientRequestProject(
  organizationId: string,
  requestId: string,
  projectId: string | null,
  actor: ClientRequestActor,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestMutationResult | { ok: false; reason: "INVALID_PROJECT" }> {
  const existing = await client.clientRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }

  if (projectId) {
    const project = await client.project.findFirst({
      where: { id: projectId, organizationId, clientId: existing.clientId },
      select: { id: true },
    });
    if (!project) {
      return { ok: false, reason: "INVALID_PROJECT" };
    }
  }

  if (existing.projectId === projectId) {
    return { ok: true, request: existing };
  }

  const runUpdate = async (tx: PrismaClientOrTx) => {
    const updated = await tx.clientRequest.update({ where: { id: requestId }, data: { projectId } });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "CLIENT_REQUEST",
      entityId: requestId,
      action: "UPDATED",
      metadata: buildClientRequestActivityMetadata(updated, actor.name, ["projectId"]),
    });

    return updated;
  };

  const request = client === prisma ? await prisma.$transaction((tx) => runUpdate(tx)) : await runUpdate(client);
  return { ok: true, request };
}

/** Soft-archives a request (same convention as Lead.archivedAt/LeadCaptureForm.archivedAt). Idempotent. No Activity row — archiving is a visibility/housekeeping action, not a lifecycle event this phase's own "lightweight useful events" list includes. */
export async function archiveClientRequest(
  organizationId: string,
  requestId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestMutationResult> {
  const existing = await client.clientRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    return { ok: true, request: existing };
  }
  const request = await client.clientRequest.update({ where: { id: requestId }, data: { archivedAt: new Date() } });
  return { ok: true, request };
}

/** Restores an archived request. Idempotent. */
export async function unarchiveClientRequest(
  organizationId: string,
  requestId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestMutationResult> {
  const existing = await client.clientRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    return { ok: true, request: existing };
  }
  const request = await client.clientRequest.update({ where: { id: requestId }, data: { archivedAt: null } });
  return { ok: true, request };
}
