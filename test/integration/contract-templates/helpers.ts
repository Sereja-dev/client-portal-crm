import { prisma } from "@/lib/prisma";
import type { ContractTemplateActor } from "@/lib/contract-templates/authorization";
import type { ContractTemplateWritableInput } from "@/lib/contract-templates/validation";
import type { TestFixtures } from "../../fixtures/seed";

/** Builds a ContractTemplateActor from a fixture user + explicit role -- fixtures/seed.ts's own SeededUser has no `role` field (role lives on Membership), so every test supplies it explicitly, matching every other domain module's own test-helper precedent in this repo. */
export function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): ContractTemplateActor {
  return { id: user.id, name: user.name, role };
}

export function templateInput(overrides: Partial<ContractTemplateWritableInput> = {}): ContractTemplateWritableInput {
  return {
    name: "Standard services agreement",
    title: "Services Agreement",
    body: "These are the standard terms and conditions...",
    ...overrides,
  };
}

/** Deletes a ContractTemplate -- it has no child table at all (unlike InvoiceTemplate/InvoiceTemplateItem), so a plain delete is always sufficient; this helper exists only for the common "delete every template id this test created" call shape. */
export async function cleanupContractTemplates(templateIds: string[]): Promise<void> {
  if (templateIds.length === 0) return;
  await prisma.contractTemplate.deleteMany({ where: { id: { in: templateIds } } });
}

export type { TestFixtures };
