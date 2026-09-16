"use server";

import { revalidatePath } from "next/cache";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { checkRateLimit, PORTAL_CONTRACT_ACCEPTANCE_LIMIT } from "@/lib/rate-limit";
import { acceptContractByPortal } from "@/lib/contracts/service";

/**
 * Contracts Portal V1 §17/§18/§19 — the only Portal-facing Contract
 * mutation. Unlike Portal Quote's own transitionPortalQuote (which
 * implements its own inline transaction/updateMany because Quote has no
 * shared domain service for this), Contract already has a fully
 * reviewed, already-shipped domain primitive — acceptContractByPortal in
 * src/lib/contracts/service.ts — so this action is a thin wrapper only:
 * it adds rate limiting, then hands off entirely to that already-audited
 * function, which self-resolves {clientId, organizationId, portalUser}
 * via getCurrentPortalUser() itself (never a caller-supplied id of any
 * kind) and performs the whole guarded transition + Activity write.
 * Locked architecture §17: "Do NOT duplicate lifecycle logic in the
 * action."
 *
 * Rate limiting mirrors PORTAL_QUOTE_DECISION_LIMIT's own exact
 * convention: keyed by the authenticated PortalUser's own id, checked
 * here (before calling the domain primitive) because that primitive has
 * no rate-limiting concern of its own — the same split Portal Quote's
 * own actions.ts already uses.
 *
 * NOT_FOUND and INVALID_TRANSITION both collapse to the same generic
 * "invalid_transition" reason returned to the client — locked
 * architecture §20: never let a Portal identity distinguish "this
 * Contract doesn't exist/isn't yours" from "this Contract exists but
 * can't be accepted right now."
 */

export type PortalContractAcceptResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "invalid_transition" };

export async function acceptPortalContractAction(contractId: string): Promise<PortalContractAcceptResult> {
  const { portalUser } = await getCurrentPortalUser(`/portal/contracts/${contractId}`);

  const limitCheck = checkRateLimit(PORTAL_CONTRACT_ACCEPTANCE_LIMIT, portalUser.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const result = await acceptContractByPortal(contractId);
  if (!result.ok) {
    return { ok: false, reason: "invalid_transition" };
  }

  // Both the Portal's own surfaces and every Staff surface that shows
  // this same Contract need to reflect the new state — matches
  // transitionPortalQuote's own identical four-path revalidation (§19).
  revalidatePath("/portal/contracts");
  revalidatePath(`/portal/contracts/${contractId}`);
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contractId}`);
  return { ok: true };
}
