"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { checkRateLimit, PORTAL_QUOTE_DECISION_LIMIT } from "@/lib/rate-limit";
import { createActivity } from "@/lib/activity/create-activity";
import { buildQuoteStatusChangeMetadata } from "@/lib/activity/quote-metadata";
import { isQuoteConverted, isQuoteExpired } from "@/lib/quotes/status";

/**
 * Quotes / Estimates Phase 4 (Client Portal approval/decline). Both
 * actions below share one transition helper: SENT -> APPROVED or
 * SENT -> DECLINED, each the Portal-facing counterpart of Staff's own
 * existing sendQuoteAction/reopenQuoteAction (Phase 2,
 * src/app/(dashboard)/quotes/actions.ts) — this file adds no new
 * lifecycle RULE, it only adds the two transitions a Staff member was
 * never meant to trigger arbitrarily (§K of this phase's own task spec:
 * "no Staff-side arbitrary Approve/Decline buttons").
 *
 * Authorization mirrors every other Portal mutation/query in this app
 * exactly: {clientId, organizationId} come only from
 * getCurrentPortalUser() (never a client-submitted id of any kind), and
 * every read/write below is scoped by both together — a foreign-org or
 * foreign-Client Quote id is indistinguishable from a nonexistent one
 * (not_found), never a distinguishable error. A Lead-only Quote
 * (clientId still null) can never match `clientId: <this Portal
 * Client's own id>` at all, so it is excluded by construction, the same
 * way getPortalQuote/getPortalQuotes already are.
 *
 * Eligibility (all re-verified from a fresh read inside the transaction,
 * never trusting a stale pre-transaction read): not archived, status is
 * exactly SENT, and not already expired (isQuoteExpired — the same
 * shared derivation Staff's own UI and this Portal's own list/detail
 * pages use, never re-derived inline). The final guarded `updateMany`
 * (`where: {..., status: "SENT"}`) is what makes this race-safe: a
 * concurrent approve/decline/second-approve/second-decline against the
 * same Quote can only ever have exactly one winner (`count === 1`); every
 * loser's `count` is 0 and maps to the same controlled
 * "invalid_transition" result, never a corrupted or double-applied
 * state.
 */

export type PortalQuoteDecisionResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_transition" };

async function transitionPortalQuote(
  quoteId: string,
  to: "APPROVED" | "DECLINED",
): Promise<PortalQuoteDecisionResult> {
  const { clientId, organizationId, portalUser } = await getCurrentPortalUser();

  const limitCheck = checkRateLimit(PORTAL_QUOTE_DECISION_LIMIT, portalUser.id);
  if (limitCheck.limited) {
    return { ok: false, reason: "rate_limited" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.quote.findFirst({
      where: { id: quoteId, clientId, organizationId },
    });
    if (!existing) {
      return "not_found" as const;
    }
    if (existing.archivedAt !== null) {
      return "invalid_transition" as const;
    }
    if (isQuoteConverted({ convertedInvoiceId: existing.convertedInvoiceId })) {
      return "invalid_transition" as const;
    }
    if (existing.status !== "SENT") {
      return "invalid_transition" as const;
    }
    if (isQuoteExpired({ status: existing.status, validUntil: existing.validUntil })) {
      return "invalid_transition" as const;
    }

    const result = await tx.quote.updateMany({
      where: { id: quoteId, clientId, organizationId, status: "SENT" },
      data:
        to === "APPROVED"
          ? { status: "APPROVED", approvedAt: new Date(), declinedAt: null }
          : { status: "DECLINED", declinedAt: new Date() },
    });
    if (result.count === 0) {
      return "invalid_transition" as const;
    }

    // actorId is always null: Activity.actor is a relation to the staff
    // User model, and a PortalUser is never a valid actor there —
    // portalUser.name doubles as the display name via formatActivity's
    // own metadata.actorName fallback, the same established convention
    // src/app/portal/invite/[token]/actions.ts already uses for
    // PORTAL_INVITATION_ACCEPTED. Reuses the exact same STATUS_CHANGED
    // action every other Quote lifecycle transition (send/reopen)
    // already writes — no new ActivityAction value is introduced.
    await createActivity(tx, {
      organizationId,
      actorId: null,
      entityType: "QUOTE",
      entityId: quoteId,
      action: "STATUS_CHANGED",
      metadata: buildQuoteStatusChangeMetadata("SENT", to, portalUser.name),
    });

    return "updated" as const;
  });

  if (outcome === "not_found") return { ok: false, reason: "not_found" };
  if (outcome === "invalid_transition") return { ok: false, reason: "invalid_transition" };

  // Both the Portal's own surfaces and every Staff surface that shows
  // this same Quote need to reflect the new state — no separate
  // synchronization mechanism exists or is needed beyond DB state plus
  // revalidating every path that reads it (§N).
  revalidatePath("/portal/quotes");
  revalidatePath(`/portal/quotes/${quoteId}`);
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${quoteId}/edit`);
  return { ok: true };
}

export async function approvePortalQuoteAction(quoteId: string): Promise<PortalQuoteDecisionResult> {
  return transitionPortalQuote(quoteId, "APPROVED");
}

export async function declinePortalQuoteAction(quoteId: string): Promise<PortalQuoteDecisionResult> {
  return transitionPortalQuote(quoteId, "DECLINED");
}
