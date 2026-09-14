import "server-only";
import { isUuid } from "@/lib/validation/lead";
import type { PrismaClientOrTx } from "./types";

/**
 * Contracts Phase 1 — resolves and validates an optional
 * `signatoryContactId` against the Contract's own `clientId`, mirroring
 * resolveContractTarget()'s own "the real authorization boundary is a
 * scoped DB lookup, never trusted from format validation alone" shape.
 *
 * Only ever called from the create/update-a-DRAFT path (a *new* or
 * *changed* signatory selection) — a currently-archived ClientContact is
 * therefore always rejected here, matching the locked rule: "do not
 * allow choosing a currently archived contact for a new/updated DRAFT
 * Contract." This function is never called again once a Contract is
 * SENT (the document is frozen — see status.ts's own isContractEditable),
 * so a contact becoming archived *after* being chosen can never
 * retroactively invalidate an already-SENT Contract or its own already-
 * written signatorySnapshot; that already-chosen id simply stops being
 * re-validated at all, which is exactly the intended behavior.
 */
export type ResolveContractSignatoryResult =
  | { ok: true; contactId: string | null }
  | { ok: false; reason: "invalid_signatory" };

export async function resolveContractSignatory(
  client: PrismaClientOrTx,
  organizationId: string,
  clientId: string,
  signatoryContactId: string | null,
): Promise<ResolveContractSignatoryResult> {
  if (signatoryContactId === null) {
    return { ok: true, contactId: null };
  }
  if (!isUuid(signatoryContactId)) {
    return { ok: false, reason: "invalid_signatory" };
  }

  const contact = await client.clientContact.findFirst({
    where: { id: signatoryContactId, organizationId, clientId, archivedAt: null },
    select: { id: true },
  });
  if (!contact) {
    return { ok: false, reason: "invalid_signatory" };
  }

  return { ok: true, contactId: contact.id };
}
