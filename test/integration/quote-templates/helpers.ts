import { prisma } from "@/lib/prisma";
import type { QuoteTemplateActor } from "@/lib/quote-templates/authorization";
import type { QuoteTemplateWritableInput } from "@/lib/quote-templates/validation";
import type { TestFixtures } from "../../fixtures/seed";

/** Builds a QuoteTemplateActor from a fixture user + explicit role -- fixtures/seed.ts's own SeededUser has no `role` field (role lives on Membership), so every test supplies it explicitly, matching every other domain module's own test-helper precedent in this repo. */
export function actorFor(user: { id: string; name: string }, role: "OWNER" | "ADMIN" | "MEMBER"): QuoteTemplateActor {
  return { id: user.id, name: user.name, role };
}

export function templateInput(overrides: Partial<QuoteTemplateWritableInput> = {}): QuoteTemplateWritableInput {
  return {
    name: "Web design",
    currency: "USD",
    items: [{ description: "Design", quantity: "1", unitPrice: "100.00" }],
    ...overrides,
  };
}

/** Deletes a QuoteTemplate and its items -- QuoteTemplateItem cascades from its parent's own onDelete: Cascade, so deleting the QuoteTemplate row alone is sufficient; this helper exists only for the common "delete every template id this test created" call shape. */
export async function cleanupQuoteTemplates(templateIds: string[]): Promise<void> {
  if (templateIds.length === 0) return;
  await prisma.quoteTemplate.deleteMany({ where: { id: { in: templateIds } } });
}

export type { TestFixtures };
