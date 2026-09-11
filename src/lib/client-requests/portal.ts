import "server-only";
import type { ClientRequest } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { createActivity } from "@/lib/activity/create-activity";
import { buildClientRequestActivityMetadata } from "@/lib/activity/client-request-metadata";
import { parseClientRequestCreateInput, PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES, type ClientRequestFieldErrors } from "@/lib/validation/client-request";

/**
 * Client Requests / Tickets, Phase 1 — Portal domain layer. Every
 * function here is scoped by `clientId`, always resolved by the caller
 * from an authenticated Client Portal session (getCurrentPortalUser())
 * and passed in explicitly — never re-derived here, and never accepted
 * as a raw parameter from anything resembling client-controlled input.
 * A request/message belonging to another Client is always treated as
 * nonexistent, never a distinguishable "exists but denied" case — same
 * isolation shape staff.ts's own organizationId scoping uses, one tier
 * narrower (by Client, not just by Organization).
 */

export type PortalClientRequestContext = {
  organizationId: string;
  clientId: string;
  portalUserId: string;
  portalUserName: string;
};

export type CreatePortalClientRequestInput = {
  title: unknown;
  description: unknown;
  priority?: unknown;
  projectId?: unknown;
};

export type CreatePortalClientRequestResult =
  | { ok: true; request: ClientRequest }
  | { ok: false; reason: "VALIDATION"; fieldErrors: ClientRequestFieldErrors }
  | { ok: false; reason: "INVALID_PROJECT" };

/**
 * A new Portal request always starts status: OPEN (the schema's own
 * @default), assignedToId: null (no auto-assignment logic exists in this
 * product — see this phase's own spec: "unless existing business logic
 * clearly supports auto-assignment", which it doesn't), and
 * organizationId/clientId/portalUserId taken ONLY from `context` — never
 * from `input`, which has no such fields at all, let alone reads them.
 * `priority` is restricted to PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES
 * (LOW/NORMAL/HIGH) — URGENT is a Staff-only escalation signal (see
 * validation/client-request.ts's own comment).
 */
export async function createPortalClientRequest(
  context: PortalClientRequestContext,
  input: CreatePortalClientRequestInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreatePortalClientRequestResult> {
  const parsed = parseClientRequestCreateInput(input, PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES);
  if (!parsed.ok) {
    return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors };
  }

  if (parsed.values.projectId) {
    const project = await client.project.findFirst({
      where: { id: parsed.values.projectId, organizationId: context.organizationId, clientId: context.clientId },
      select: { id: true },
    });
    if (!project) {
      return { ok: false, reason: "INVALID_PROJECT" };
    }
  }

  const runCreate = async (tx: PrismaClientOrTx) => {
    const created = await tx.clientRequest.create({
      data: {
        organizationId: context.organizationId,
        clientId: context.clientId,
        portalUserId: context.portalUserId,
        projectId: parsed.values.projectId,
        title: parsed.values.title,
        description: parsed.values.description,
        priority: parsed.values.priority,
        // status: not set — the schema's own @default(OPEN) applies.
        // assignedToId: not set — always null for a Portal-created request.
      },
    });

    // actorId is always null: Activity.actor is a relation to the staff
    // User model, and a PortalUser is never a valid actor there —
    // portalUserName doubles as the display name via metadata.actorName,
    // the same established convention
    // src/app/portal/(app)/quotes/actions.ts's own STATUS_CHANGED write
    // and src/app/portal/invite/[token]/actions.ts's own
    // PORTAL_INVITATION_ACCEPTED write already use.
    await createActivity(tx, {
      organizationId: context.organizationId,
      actorId: null,
      entityType: "CLIENT_REQUEST",
      entityId: created.id,
      action: "CREATED",
      metadata: buildClientRequestActivityMetadata(created, context.portalUserName),
    });

    return created;
  };

  const request = client === prisma ? await prisma.$transaction((tx) => runCreate(tx)) : await runCreate(client);
  return { ok: true, request };
}

/** Active (non-archived) requests for this Client, newest first. Archived requests are Staff-only housekeeping state — never surfaced in a Portal list, though a direct getPortalClientRequest lookup still resolves one (see that function's own comment). */
export async function listPortalClientRequests(clientId: string, client: PrismaClientOrTx = prisma): Promise<ClientRequest[]> {
  return client.clientRequest.findMany({
    where: { clientId, archivedAt: null },
    orderBy: [{ createdAt: "desc" }],
  });
}

/** Scoped by clientId only — a request belonging to another Client is indistinguishable from a nonexistent one. Returns an archived request too (same get-vs-list asymmetry as getCustomStatusDefinition/getLeadCaptureForm): a Portal user following a link to their own already-archived ticket should still be able to open it, even though it's excluded from listPortalClientRequests' own default view. */
export async function getPortalClientRequest(clientId: string, requestId: string, client: PrismaClientOrTx = prisma): Promise<ClientRequest | null> {
  return client.clientRequest.findFirst({ where: { id: requestId, clientId } });
}
