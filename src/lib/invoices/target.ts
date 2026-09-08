import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Quotes / Estimates Phase 2.3 — the durable Invoice target invariant
 * (Invoice / Project Coupling Audit + the staged Phase 2.2/2.2b/2.3
 * rollout): `clientId` is REQUIRED, `projectId` is OPTIONAL. When a
 * `projectId` is supplied, the Project must belong to this exact
 * organization AND its `clientId` must equal the chosen Client's — a
 * Project can never be attached to an Invoice for a different Client,
 * even within the same organization.
 *
 * Never trusts that a submitted clientId/projectId actually belongs to
 * the caller's own organization (or to each other) just because it
 * passed format validation in src/lib/validation/invoice.ts — every
 * lookup here is the real authorization boundary, exactly mirroring
 * src/lib/quotes/target.ts's own resolveQuoteTarget().
 *
 * A foreign/nonexistent Client, a foreign/nonexistent Project, or a
 * Project belonging to a different Client all collapse to the identical
 * "invalid_target" result — never a distinguishable response that could
 * be used as an existence oracle for another organization's data.
 */

export type ResolvedInvoiceTarget = { clientId: string; projectId: string | null };

export type ResolveInvoiceTargetResult =
  | { ok: true; target: ResolvedInvoiceTarget }
  | { ok: false; reason: "invalid_target" };

/**
 * Accepts either the top-level `prisma` client or an open
 * Prisma.TransactionClient — a caller can resolve the target either
 * before opening its own write transaction (create) or from inside one
 * (an update that's also changing the target, alongside other writes in
 * the same transaction).
 */
export async function resolveInvoiceTarget(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  target: { clientId: string; projectId: string | null },
): Promise<ResolveInvoiceTargetResult> {
  const clientRow = await client.client.findFirst({
    where: { id: target.clientId, organizationId },
    select: { id: true },
  });
  if (!clientRow) {
    return { ok: false, reason: "invalid_target" };
  }

  if (target.projectId === null) {
    return { ok: true, target: { clientId: clientRow.id, projectId: null } };
  }

  const project = await client.project.findFirst({
    where: { id: target.projectId, organizationId },
    select: { id: true, clientId: true },
  });
  if (!project || project.clientId !== clientRow.id) {
    return { ok: false, reason: "invalid_target" };
  }

  return { ok: true, target: { clientId: clientRow.id, projectId: project.id } };
}
