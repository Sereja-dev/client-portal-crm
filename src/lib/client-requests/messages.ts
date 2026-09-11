import "server-only";
import type { ClientRequestMessage } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { verifyMembership } from "./staff";
import { validateCommentBody, type CommentBodyValidationResult } from "@/lib/comments/validate-body";

/**
 * Client Requests / Tickets, Phase 1 — the conversation domain layer.
 * Immutable V1 messages (no edit, no delete, no attachments — see
 * ClientRequestMessage's own schema doc comment). Exactly two create
 * functions exist, and they are the ONLY code path that ever constructs
 * a row: addStaffClientRequestMessage always writes {authorType: STAFF,
 * staffUserId: <this User's id>, portalUserId: null},
 * addPortalClientRequestMessage always writes the mirror image — this is
 * what "author integrity" actually means in this phase (see
 * ClientRequestMessageAuthorType's own schema comment for why this is
 * enforced here, not via a database CHECK constraint).
 *
 * Message bodies reuse src/lib/comments/validate-body.ts's existing
 * validateCommentBody/COMMENT_BODY_MAX_LENGTH as-is — plain text, no
 * Markdown/HTML, same "rendering safety comes from never trusting it as
 * markup" discipline Comment.body already established. No Activity row
 * is written for a message add — this phase's own "lightweight useful
 * events" list (request created, status changed, assignment changed,
 * resolved/closed) deliberately does not include it, and a message
 * timeline is already its own natural audit trail.
 */

export type AddClientRequestMessageResult =
  | { ok: true; message: ClientRequestMessage }
  | { ok: false; reason: "REQUEST_NOT_FOUND" }
  | { ok: false; reason: "INVALID_AUTHOR" }
  | { ok: false; reason: "VALIDATION"; error: Extract<CommentBodyValidationResult, { ok: false }>["error"] };

/**
 * `staffUserId` must independently hold a real Membership in
 * `organizationId` — the same defense-in-depth boundary check
 * staff.ts's own mutations apply, never assumed just because the caller
 * says so (Section: "Staff author must belong to request Organization").
 */
export async function addStaffClientRequestMessage(
  organizationId: string,
  requestId: string,
  staffUserId: string,
  body: unknown,
  client: PrismaClientOrTx = prisma,
): Promise<AddClientRequestMessageResult> {
  const request = await client.clientRequest.findFirst({ where: { id: requestId, organizationId }, select: { id: true } });
  if (!request) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }

  if (!(await verifyMembership(staffUserId, organizationId, client))) {
    return { ok: false, reason: "INVALID_AUTHOR" };
  }

  const validated = validateCommentBody(body);
  if (!validated.ok) {
    return { ok: false, reason: "VALIDATION", error: validated.error };
  }

  const message = await client.clientRequestMessage.create({
    data: {
      organizationId,
      requestId,
      authorType: "STAFF",
      staffUserId,
      portalUserId: null,
      body: validated.body,
    },
  });

  return { ok: true, message };
}

/**
 * `portalUserId` must independently belong to this exact `clientId` — the
 * same defense-in-depth boundary check as the Staff side (Section:
 * "PortalUser must belong to Client"), never assumed just because the
 * caller says so.
 *
 * Excludes an archived request (Phase 2A §"ARCHIVE": "Portal behavior
 * for archived request must be explicit: ... inaccessible") — same
 * treatment as getPortalClientRequest's own identical Phase 2A
 * tightening, and for the same reason: an archived request is
 * indistinguishable from a nonexistent one for Portal.
 */
export async function addPortalClientRequestMessage(
  clientId: string,
  requestId: string,
  portalUserId: string,
  body: unknown,
  client: PrismaClientOrTx = prisma,
): Promise<AddClientRequestMessageResult> {
  const request = await client.clientRequest.findFirst({
    where: { id: requestId, clientId, archivedAt: null },
    select: { id: true, organizationId: true },
  });
  if (!request) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }

  const portalUser = await client.portalUser.findFirst({ where: { id: portalUserId, clientId }, select: { id: true } });
  if (!portalUser) {
    return { ok: false, reason: "INVALID_AUTHOR" };
  }

  const validated = validateCommentBody(body);
  if (!validated.ok) {
    return { ok: false, reason: "VALIDATION", error: validated.error };
  }

  const message = await client.clientRequestMessage.create({
    data: {
      organizationId: request.organizationId,
      requestId,
      authorType: "PORTAL",
      staffUserId: null,
      portalUserId,
      body: validated.body,
    },
  });

  return { ok: true, message };
}

/**
 * Phase 2A: both listing functions now also join each message's own
 * staffUser.name/portalUser.name — display data only (a name is never a
 * secret), needed so the conversation UI can show a real author identity
 * without a second round trip. Still returns `[]` for a request with no
 * messages and `null` for a foreign one — this join changes nothing
 * about scoping/authorization.
 */
const MESSAGE_AUTHOR_INCLUDE = {
  staffUser: { select: { name: true } },
  portalUser: { select: { name: true } },
} as const;

export type ClientRequestMessageWithAuthor = ClientRequestMessage & {
  staffUser: { name: string } | null;
  portalUser: { name: string } | null;
};

/** Staff-scoped listing — null if `requestId` doesn't belong to `organizationId`, indistinguishable from a nonexistent request. */
export async function listClientRequestMessagesForOrganization(
  organizationId: string,
  requestId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestMessageWithAuthor[] | null> {
  const request = await client.clientRequest.findFirst({ where: { id: requestId, organizationId }, select: { id: true } });
  if (!request) return null;

  return client.clientRequestMessage.findMany({ where: { requestId }, orderBy: [{ createdAt: "asc" }], include: MESSAGE_AUTHOR_INCLUDE });
}

/** Portal-scoped listing — null if `requestId` doesn't belong to `clientId`, indistinguishable from a nonexistent request. */
export async function listClientRequestMessagesForClient(
  clientId: string,
  requestId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientRequestMessageWithAuthor[] | null> {
  const request = await client.clientRequest.findFirst({ where: { id: requestId, clientId }, select: { id: true } });
  if (!request) return null;

  return client.clientRequestMessage.findMany({ where: { requestId }, orderBy: [{ createdAt: "asc" }], include: MESSAGE_AUTHOR_INCLUDE });
}
