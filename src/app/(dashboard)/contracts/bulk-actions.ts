"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { archiveContract } from "@/lib/contracts/service";
import { BULK_SELECTION_MAX, type BulkActionResult } from "@/lib/bulk-actions/shared";

/**
 * Tables Improvement Slice C — Contracts' one approved V1 bulk action:
 * Archive, on the Active view only (locked spec §10). Mirrors Tasks' own
 * bulk-actions.ts architecture exactly: never a giant
 * `prisma.contract.updateMany({ where: { id: { in: ids } } })` shortcut
 * — every id is processed through the exact same single-record
 * archiveContract() domain function the detail page's own
 * ContractLifecycleControls and the list's own RowActionMenu-driven
 * ContractArchiveRestoreAction already call, so single/bulk semantics
 * can never drift. A stale/foreign/already-archived id fails or no-ops
 * for that one row only (archiveContract's own existing NOT_FOUND
 * guard/idempotency, both completely unmodified) — it never aborts the
 * ids that DID succeed, and never leaks whether a foreign id exists
 * (NOT_FOUND is already indistinguishable from "never existed").
 *
 * No bulk Restore, Send, Accept, Terminate, Preview, Edit, or Delete —
 * none of those are approved for V1 (locked spec §10).
 */
export async function bulkArchiveContractsAction(contractIds: string[]): Promise<BulkActionResult> {
  // Never trusts the client-supplied count alone — hard-capped
  // server-side regardless of what the selection UI already limits
  // client-side.
  if (contractIds.length > BULK_SELECTION_MAX) {
    return { updatedCount: 0, failedCount: contractIds.length, failures: [{ id: "", reason: "TOO_MANY_SELECTED" }] };
  }

  const { organizationId } = await getCurrentUserOrganization();
  const boundedIds = contractIds.slice(0, BULK_SELECTION_MAX);

  let updatedCount = 0;
  const failures: { id: string; reason: string }[] = [];

  for (const contractId of boundedIds) {
    const result = await archiveContract(organizationId, contractId);
    if (result.ok) {
      updatedCount++;
    } else {
      failures.push({ id: contractId, reason: result.reason });
    }
  }

  revalidatePath("/contracts");
  return { updatedCount, failedCount: failures.length, failures };
}
