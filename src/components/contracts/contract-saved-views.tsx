"use client";

import { SavedViewsControl } from "@/components/list/saved-views-control";
import { buildContractHrefFromSavedViewParams } from "@/app/(dashboard)/contracts/saved-view";

/**
 * Tables Improvement Slice D1 — thin Contract-specific integration of
 * the shared SavedViewsControl. See InvoiceSavedViews' own header
 * comment (src/components/invoices/invoice-saved-views.tsx) for why this
 * one-hop "use client" wrapper is required rather than passing
 * `buildContractHrefFromSavedViewParams` as a prop directly from the
 * (Server Component) Contracts page.
 */
export function ContractSavedViews({
  organizationId,
  userId,
  currentParams,
}: {
  organizationId: string;
  userId: string;
  currentParams: Record<string, string>;
}) {
  return (
    <SavedViewsControl
      organizationId={organizationId}
      userId={userId}
      surface="contracts"
      currentParams={currentParams}
      buildApplyHref={buildContractHrefFromSavedViewParams}
    />
  );
}
