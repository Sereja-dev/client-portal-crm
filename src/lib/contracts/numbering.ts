/**
 * Contracts Phase 1 — a USER-FACING SUGGESTION only, never an
 * authoritative source of uniqueness. Mirrors Quote's own numbering
 * model exactly (src/lib/quotes/numbering.ts): a plain, fully-editable
 * text field (`Contract.contractNumber`), with
 * `@@unique([organizationId, contractNumber])` plus catching the
 * resulting `P2002` in the create/send path as the real race-safety
 * mechanism — never a database sequence/counter table. Two concurrent
 * callers computing the *same* suggestion is expected and harmless;
 * whichever one actually creates a Contract first simply wins.
 *
 * Pure — no I/O, no Prisma import, no `server-only` — fully unit-
 * testable and safe to import from anywhere, including a future Client
 * Component. The real, DB-touching half a future create-Contract
 * page/action would call is suggest-next-contract-number.ts, kept in its
 * own file specifically so importing that Prisma-backed, server-only
 * module never becomes a prerequisite for using this pure function alone
 * (same reasoning suggest-next-quote-number.ts's own header comment
 * gives for the identical split).
 */

const CONTRACT_NUMBER_PREFIX = "C-";
const CONTRACT_NUMBER_PAD_WIDTH = 4;
const CONTRACT_NUMBER_PATTERN = /^C-(\d+)$/;

/**
 * Takes whatever `Contract.contractNumber` values already exist for the
 * caller's own organization (already fetched by the caller) and suggests
 * the next conventional "C-0001"-style number. Any existing value that
 * doesn't match the exact `C-<digits>` shape (a manually-entered
 * reference number, an imported legacy number, anything else) is
 * silently ignored — it neither breaks this suggestion nor influences
 * it, exactly like computeNextQuoteNumberSuggestion's own identical rule.
 */
export function computeNextContractNumberSuggestion(existingNumbers: readonly string[]): string {
  let highest = 0;
  for (const raw of existingNumbers) {
    const match = CONTRACT_NUMBER_PATTERN.exec(raw.trim());
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > highest) {
      highest = parsed;
    }
  }
  const next = highest + 1;
  return `${CONTRACT_NUMBER_PREFIX}${String(next).padStart(CONTRACT_NUMBER_PAD_WIDTH, "0")}`;
}

export { CONTRACT_NUMBER_PREFIX };
