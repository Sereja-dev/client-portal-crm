import "server-only";
import { prisma } from "@/lib/prisma";
import { computeNextQuoteNumberSuggestion, QUOTE_NUMBER_PREFIX } from "./numbering";

/**
 * Quotes / Estimates Phase 1 — the real, DB-touching half of the
 * numbering helper (see numbering.ts's own header comment for the full
 * "advisory only" contract this shares). A future create-Quote
 * page/action calls this directly. Only ever reads — never reserves,
 * allocates, or writes anything, so calling it any number of times
 * (including concurrently, including without ever actually creating a
 * Quote afterward) is always safe and side-effect-free. Scoped to the
 * caller's own `organizationId` only — never trusts or accepts one from
 * anywhere else.
 *
 * `import "server-only"` — this module has a real Prisma import and is
 * exclusively reachable from a future create-Quote Server Component/
 * Server Action, never a Client Component (mirroring the exact reasoning
 * src/lib/invoices/pdf/snapshot-types.ts's own header comment gives for
 * the identical annotation). Kept in its own file, separate from the
 * pure computeNextQuoteNumberSuggestion() this wraps, specifically so
 * this annotation's client-component guard never fires for code that
 * only needs the pure half.
 */
export async function suggestNextQuoteNumber(organizationId: string): Promise<string> {
  const rows = await prisma.quote.findMany({
    where: { organizationId, number: { startsWith: QUOTE_NUMBER_PREFIX } },
    select: { number: true },
  });
  return computeNextQuoteNumberSuggestion(rows.map((row) => row.number));
}
