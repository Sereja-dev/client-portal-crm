import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ParsedQuoteTarget } from "@/lib/validation/quote";

/**
 * Quotes / Estimates Phase 2 — target resolution (the approved Phase 1
 * ownership rule, applied server-side). Never trusts that a submitted
 * leadId/clientId actually belongs to the caller's own organization just
 * because it passed format validation in src/lib/validation/quote.ts —
 * every lookup here is the real authorization boundary, scoped by
 * organizationId, exactly like verifyAssigneeInOrganization does for
 * Lead's own assignedToUserId.
 *
 * A foreign or nonexistent id produces the exact same "invalid_target"
 * result either way — never a distinguishable "exists in another org" vs
 * "doesn't exist at all" response, so this can never be used as an
 * existence oracle.
 */

export type ResolvedQuoteTarget = { leadId: string | null; clientId: string | null };

export type ResolveQuoteTargetResult =
  | { ok: true; target: ResolvedQuoteTarget }
  | { ok: false; reason: "invalid_target" };

/**
 * Accepts either the top-level `prisma` client or an open
 * Prisma.TransactionClient, so a caller can resolve the target either
 * before opening its own write transaction (create) or from inside one
 * (an update that's also changing the target, alongside other writes in
 * the same transaction).
 */
export async function resolveQuoteTarget(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  target: ParsedQuoteTarget,
): Promise<ResolveQuoteTargetResult> {
  if (target.kind === "client") {
    const clientRow = await client.client.findFirst({
      where: { id: target.clientId, organizationId },
      select: { id: true },
    });
    if (!clientRow) {
      return { ok: false, reason: "invalid_target" };
    }
    return { ok: true, target: { leadId: null, clientId: clientRow.id } };
  }

  // Archived Leads are excluded — the same "archivedAt: null" gate
  // convertLeadToClientAction's own pre-check already applies to Lead
  // conversion, treated here as the established product precedent for
  // "is this Lead a valid target for a new commitment" (a Quote, exactly
  // like a conversion, is a real forward-looking commitment against this
  // Lead, not a passive read).
  const lead = await client.lead.findFirst({
    where: { id: target.leadId, organizationId, archivedAt: null },
    select: { id: true, convertedClientId: true },
  });
  if (!lead) {
    return { ok: false, reason: "invalid_target" };
  }

  // Already-converted Lead: carry both ids (lineage + current Client) —
  // never regress to leadId-only. This is the durable invariant approved
  // in Phase 1 (see Quote's own schema comment): once a Lead has
  // converted, every Quote attached to it — including a brand-new one
  // created after the fact — should reflect the Client that already
  // exists, not pretend the Lead is still unconverted.
  return {
    ok: true,
    target: { leadId: lead.id, clientId: lead.convertedClientId },
  };
}
