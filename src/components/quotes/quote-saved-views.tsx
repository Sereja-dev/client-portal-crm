"use client";

import { SavedViewsControl } from "@/components/list/saved-views-control";
import { buildQuoteHrefFromSavedViewParams } from "@/app/(dashboard)/quotes/saved-view";

/**
 * Tables Improvement Slice D2A — thin Quote-specific integration of the
 * shared SavedViewsControl. See InvoiceSavedViews' own header comment
 * (src/components/invoices/invoice-saved-views.tsx) for why this
 * one-hop "use client" wrapper is required rather than passing
 * `buildQuoteHrefFromSavedViewParams` as a prop directly from the
 * (Server Component) Quotes page.
 */
export function QuoteSavedViews({
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
      surface="quotes"
      currentParams={currentParams}
      buildApplyHref={buildQuoteHrefFromSavedViewParams}
    />
  );
}
