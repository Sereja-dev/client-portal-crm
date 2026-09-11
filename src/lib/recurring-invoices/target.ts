import "server-only";
import type { PrismaClientOrTx } from "./types";

/**
 * Recurring Invoices Phase 1 — the same Client-required/Project-optional
 * target invariant Invoice's own resolveInvoiceTarget() enforces
 * (src/lib/invoices/target.ts), independently re-implemented here rather
 * than imported cross-domain — matches this codebase's own established
 * convention of each feature owning a small copy of this exact shape
 * (Invoice has its own, Quotes has its own src/lib/quotes/target.ts's
 * resolveQuoteTarget(), per that file's own header comment) rather than
 * one shared cross-domain resolver.
 *
 * Never trusts that a submitted clientId/projectId actually belongs to the
 * caller's own organization (or to each other) just because it passed
 * format validation upstream — every lookup here is the real authorization
 * boundary. A foreign/nonexistent Client, a foreign/nonexistent Project,
 * or a Project belonging to a different Client all collapse to the
 * identical "invalid_target" result — never a distinguishable response
 * that could be used as an existence oracle for another organization's
 * data.
 */

export type ResolvedRecurringInvoiceTarget = { clientId: string; projectId: string | null };

export type ResolveRecurringInvoiceTargetResult =
  | { ok: true; target: ResolvedRecurringInvoiceTarget }
  | { ok: false; reason: "invalid_target" };

export async function resolveRecurringInvoiceTarget(
  client: PrismaClientOrTx,
  organizationId: string,
  target: { clientId: string; projectId: string | null },
): Promise<ResolveRecurringInvoiceTargetResult> {
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
