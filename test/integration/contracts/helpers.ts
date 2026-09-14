import { prisma } from "@/lib/prisma";
import type { ContractActor } from "@/lib/contracts/authorization";
import type { ContractWritableInput } from "@/lib/contracts/validation";

/** Mirrors test/integration/quote-templates/helpers.ts's own actorFor exactly — fixtures/seed.ts's SeededUser has no `role` field (role lives on Membership), so every test supplies it explicitly. */
export function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): ContractActor {
  return { id: user.id, name: user.name, role };
}

/** Every field required by parseContractInput, plus a unique-enough default contractNumber so parallel `it()` blocks in the same file never collide against the real @@unique([organizationId, contractNumber]) constraint. */
export function contractInput(clientId: string, overrides: Partial<ContractWritableInput> = {}): ContractWritableInput {
  return {
    contractNumber: `C-TEST-${Math.random().toString(36).slice(2, 10)}`,
    title: "Master Services Agreement",
    body: "This agreement is entered into by and between the parties as of the issue date below.",
    clientId,
    issueDate: "2026-06-01",
    ...overrides,
  };
}

/** Deletes every Contract row this test created -- Contract.organizationId/clientId are both onDelete: Restrict, so any leftover row would make cleanupTestData's own organization.deleteMany/client.deleteMany fail. */
export async function cleanupContracts(contractIds: string[]): Promise<void> {
  if (contractIds.length === 0) return;
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
}
