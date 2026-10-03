import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Quote Duplicate-as-new-DRAFT — the one Prisma-touching boundary this
 * feature adds, matching src/lib/invoices/duplicate-source.ts's own
 * established lib-module-with-a-direct-prisma-import convention exactly.
 *
 * Unlike Invoice's own CANCELLED-only duplicate source, a Quote may be
 * duplicated from ANY status (DRAFT/SENT/APPROVED/DECLINED, expired,
 * converted, or archived) — duplication is a copy-as-new-draft workflow,
 * it never reopens or mutates the source, so there is no lifecycle-state
 * reason to restrict which Quote is eligible (see the Finance Document
 * Actions audit's own §E/§K findings: Invoice's CANCELLED-only rule is a
 * documented "correction flow" policy specific to Invoice, not a general
 * duplicate-safety invariant).
 *
 * `DUPLICATE_SOURCE_SELECT` is the single source of truth for both the
 * query and its result type — `DuplicateSourceQuote` is inferred from it
 * via `Prisma.QuoteGetPayload`, never hand-maintained separately.
 * `select`, never `include` — this feature does not need every scalar
 * column (sentAt/recipientName/approvedAt/declinedAt/convertedInvoiceId/
 * archivedAt are all deliberately excluded; see duplicate.ts's own
 * field-reset contract for why none of them ever travel to the new Quote).
 */
const DUPLICATE_SOURCE_SELECT = {
  id: true,
  // Display-only on the duplicate page (e.g. "pre-filled from quote
  // Q-0001") — never placed into the new Quote's own `number` field,
  // which always comes from a fresh suggestNextQuoteNumber() call
  // instead (see duplicate.ts's own header comment).
  number: true,
  leadId: true,
  clientId: true,
  title: true,
  currency: true,
  notes: true,
  discountType: true,
  discountValue: true,
  taxRatePercent: true,
  taxLabel: true,
  items: {
    orderBy: { position: "asc" },
    select: {
      description: true,
      quantity: true,
      unitPrice: true,
    },
  },
} satisfies Prisma.QuoteSelect;

export type DuplicateSourceQuote = Prisma.QuoteGetPayload<{ select: typeof DUPLICATE_SOURCE_SELECT }>;

/**
 * Returns the organization-scoped source Quote a Duplicate page may
 * prefill from, at ANY status, or `null` for a cross-organization or
 * nonexistent id (the two are structurally indistinguishable — the same
 * scoped `findFirst`, the same `null` result, either way). No archivedAt
 * filter — an archived Quote remains a valid duplicate source (§18 of
 * this slice's own spec: "Duplicate may copy from archived source, but
 * new Quote must be active/unarchived DRAFT").
 */
export async function getDuplicateSourceQuote(
  quoteId: string,
  organizationId: string,
): Promise<DuplicateSourceQuote | null> {
  return prisma.quote.findFirst({
    where: { id: quoteId, organizationId },
    select: DUPLICATE_SOURCE_SELECT,
  });
}
