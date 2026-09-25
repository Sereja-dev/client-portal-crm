import { Prisma } from "@/generated/prisma/browser";
import { formatCurrency } from "@/lib/format";

// `@/generated/prisma/browser`'s own namespace exports `Decimal` as a
// value only (no companion `export type Decimal = ...`), so
// `Prisma.Decimal` cannot be written in a TYPE position — same
// documented constraint src/lib/invoices/currencies.ts's own identical
// local alias already works around. `InstanceType<typeof Prisma.Decimal>`
// recovers the instance type.
type Decimal = InstanceType<typeof Prisma.Decimal>;

/**
 * Lead Value Currency Correctness fix — the single shared implementation
 * every Lead.value display (List desktop table, List mobile record
 * card, Pipeline card) formats through, so the null-currency check can
 * never drift between call sites. A null/undefined `value` stays exactly
 * "—" (unchanged pre-fix behavior — every call site already treated a
 * missing value this way); a present `value` with no resolvable
 * organization currency (`currency` null) is ALSO "—" — this is the
 * actual fix: never fall through to formatCurrency's own hardcoded USD
 * default. Matches the Dashboard's own identical
 * `currency ? formatCurrency(...) : "—"` convention exactly
 * (src/app/(dashboard)/dashboard/page.tsx).
 *
 * Deliberately dependency-free (no Prisma client, no next/navigation) so
 * it's safely importable from both the Server Component List page
 * (leads/page.tsx, where `value` is a real Prisma.Decimal straight from
 * prisma.lead.findMany) and the Client Component Pipeline card
 * (lead-pipeline-card.tsx, where `value` is the stringified Decimal its
 * own server/client boundary already requires — see pipeline-query.ts's
 * own PipelineLead.value doc comment) without pulling either one's own
 * runtime into the other's bundle. Only `@/generated/prisma/browser`'s
 * Decimal *type* is imported (erased at build time), the same
 * client-safety precedent src/lib/invoices/currencies.ts already
 * established for an identical cross-boundary amount type.
 */
export type LeadValueInput = Decimal | string | number | null | undefined;

export function formatLeadValue(value: LeadValueInput, currency: string | null): string {
  if (value === null || value === undefined) return "—";
  return currency ? formatCurrency(Number(value), currency) : "—";
}
