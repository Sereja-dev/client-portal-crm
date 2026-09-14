import "server-only";
import { prisma } from "@/lib/prisma";
import { computeNextContractNumberSuggestion, CONTRACT_NUMBER_PREFIX } from "./numbering";

/**
 * Contracts Phase 1 — the real, DB-touching half of the numbering helper
 * (see numbering.ts's own header comment for the full "advisory only"
 * contract this shares). Only ever reads — never reserves, allocates, or
 * writes anything, so calling it any number of times is always safe and
 * side-effect-free. Scoped to the caller's own `organizationId` only.
 */
export async function suggestNextContractNumber(organizationId: string): Promise<string> {
  const rows = await prisma.contract.findMany({
    where: { organizationId, contractNumber: { startsWith: CONTRACT_NUMBER_PREFIX } },
    select: { contractNumber: true },
  });
  return computeNextContractNumberSuggestion(rows.map((row) => row.contractNumber));
}
