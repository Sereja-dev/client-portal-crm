import "server-only";
import { prisma } from "@/lib/prisma";
import { getCompanyProfile } from "@/lib/organization-setup/company-profile";
import { resolveInvoiceCurrencyDefault } from "@/lib/invoices/currencies";

/**
 * Reports Phase 1 — Invoice.currency is a genuine per-invoice field (see
 * src/app/(dashboard)/invoices/new/page.tsx's own currency `<select>`),
 * not an organization-locked constant, so a naive `SUM(amount)` across
 * every currency an organization happens to have used would silently
 * blend incompatible units into one meaningless number (a $100 USD
 * invoice + a €100 EUR invoice is not "200" of anything real). Every
 * Reports financial query is therefore always scoped to exactly one
 * selected currency — this module is the one place that selection is
 * decided, deterministically, so no query file has to reinvent the rule.
 *
 * No FX conversion exists or is ever performed here, and no query
 * anywhere in Reports Phase 1 ever aggregates `amount` across more than
 * one `currency` value at once.
 */

export type ReportsCurrencySelection = {
  /**
   * `null` only in the theoretical case where this organization has no
   * invoices at all AND resolveInvoiceCurrencyDefault() somehow returned
   * no currency — that function's own contract always returns a real
   * currency (worst case "USD"), so this is not reachable today, but the
   * type stays nullable so a future change to that contract can never
   * silently violate this function's own "always tell the caller when
   * there is truly no financial data" guarantee.
   */
  selectedCurrency: string | null;
  /** Every distinct currency this organization's own invoices actually use, sorted ascending. Empty when this organization has zero invoices. Never includes another organization's currencies. */
  availableCurrencies: readonly string[];
};

/**
 * Deterministic currency selection for one organization's Reports:
 *
 * 1. Normalize `requestedCurrency` (trim + uppercase) — never trusted
 *    from the URL as-is.
 * 2. If the normalized value is one this organization's OWN invoices
 *    actually use, select it. This is the real validation boundary — a
 *    currency not present in `availableCurrencies` (a forged code, a
 *    real ISO code this org has simply never invoiced in, or another
 *    tenant's currency) is never selectable, regardless of whether it's
 *    a globally "valid" ISO 4217 code.
 * 3. Otherwise fall back to this organization's own canonical default
 *    invoice currency (the exact mechanism `/invoices/new` already uses
 *    to default a new invoice's currency field —
 *    resolveInvoiceCurrencyDefault(companyProfile.currency), reused here
 *    rather than reinvented) — but ONLY if that default currency is
 *    itself actually present among this org's invoices.
 * 4. Otherwise fall back to the first (alphabetically, for determinism)
 *    currency this organization's invoices actually use.
 * 5. If this organization has no invoices at all, `availableCurrencies`
 *    is empty and `selectedCurrency` is still the canonical org default
 *    (so a brand-new organization with zero invoices gets a sensible,
 *    stable currency to label its all-zero financial KPIs with, rather
 *    than an unlabeled `null`) — see this type's own doc comment for the
 *    one theoretical exception.
 */
export async function resolveReportsCurrency(
  organizationId: string,
  requestedCurrency: string | string[] | undefined,
): Promise<ReportsCurrencySelection> {
  const distinctRows = await prisma.invoice.findMany({
    where: { organizationId },
    distinct: ["currency"],
    select: { currency: true },
  });
  const availableCurrencies = distinctRows.map((row) => row.currency).sort();
  const availableSet = new Set(availableCurrencies);

  const requestedRaw = Array.isArray(requestedCurrency) ? requestedCurrency[0] : requestedCurrency;
  const normalizedRequested = requestedRaw?.trim().toUpperCase() || null;

  if (normalizedRequested && availableSet.has(normalizedRequested)) {
    return { selectedCurrency: normalizedRequested, availableCurrencies };
  }

  const companyProfile = await getCompanyProfile(organizationId);
  const orgDefaultCurrency = resolveInvoiceCurrencyDefault(companyProfile.currency).currency;

  if (availableSet.has(orgDefaultCurrency)) {
    return { selectedCurrency: orgDefaultCurrency, availableCurrencies };
  }

  if (availableCurrencies.length > 0) {
    return { selectedCurrency: availableCurrencies[0], availableCurrencies };
  }

  return { selectedCurrency: orgDefaultCurrency ?? null, availableCurrencies: [] };
}
