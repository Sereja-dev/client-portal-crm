import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Contracts Phase 1 — the durable Contract target invariant, mirroring
 * src/lib/invoices/target.ts's own resolveInvoiceTarget() exactly:
 * `clientId` is REQUIRED, `projectId` is OPTIONAL. When a `projectId` is
 * supplied, the Project must belong to this exact organization AND its
 * `clientId` must equal the chosen Client's — a Project can never be
 * attached to a Contract for a different Client, even within the same
 * organization. `Project.clientId` is itself a required, NOT NULL column
 * (confirmed directly against prisma/schema.prisma, not assumed) — every
 * Project unconditionally belongs to exactly one Client, so this
 * comparison is always meaningful, never a maybe.
 *
 * Never trusts that a submitted clientId/projectId actually belongs to
 * the caller's own organization (or to each other) just because it
 * passed format validation in src/lib/contracts/validation.ts — every
 * lookup here is the real authorization boundary.
 *
 * A foreign/nonexistent Client, a foreign/nonexistent Project, or a
 * Project belonging to a different Client all collapse to the identical
 * "invalid_target" result — never a distinguishable response that could
 * be used as an existence oracle for another organization's data.
 */

export type ResolvedContractTarget = { clientId: string; projectId: string | null };

export type ResolveContractTargetResult =
  | { ok: true; target: ResolvedContractTarget }
  | { ok: false; reason: "invalid_target" };

/**
 * Accepts either the top-level `prisma` client or an open
 * Prisma.TransactionClient — a caller can resolve the target either
 * before opening its own write transaction (create) or from inside one
 * (send/update, alongside other writes in the same transaction).
 */
export async function resolveContractTarget(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  target: { clientId: string; projectId: string | null },
): Promise<ResolveContractTargetResult> {
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
