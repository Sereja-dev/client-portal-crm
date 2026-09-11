import type { ClientRequestMessageWithAuthor } from "./messages";

/**
 * Client Requests / Tickets Phase 2A — pure view-model shaping for one
 * message, split out so the conversation UI never touches the raw
 * Prisma row (or its authorType/staffUserId/portalUserId columns)
 * directly. Handles the "author identity later deleted" case
 * (staffUser/portalUser join comes back null — see
 * ClientRequestMessage's own schema doc comment: SetNull, not Cascade,
 * exactly so a message survives its author's own deletion) with a
 * generic, honest fallback label rather than blank/undefined.
 */

export type ClientRequestMessageViewModel = {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string;
  authorType: "STAFF" | "PORTAL";
};

export function formatClientRequestMessage(message: ClientRequestMessageWithAuthor): ClientRequestMessageViewModel {
  const authorName =
    message.authorType === "STAFF"
      ? (message.staffUser?.name ?? "Former staff member")
      : (message.portalUser?.name ?? "Former client contact");

  return {
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    authorName,
    authorType: message.authorType,
  };
}
