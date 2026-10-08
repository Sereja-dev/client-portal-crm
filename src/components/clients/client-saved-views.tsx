"use client";

import { SavedViewsControl } from "@/components/list/saved-views-control";
import { buildClientHrefFromSavedViewParams } from "@/app/(dashboard)/clients/saved-view";

/**
 * Tables Improvement Slice D2B — thin Client-specific integration of the
 * shared SavedViewsControl. See QuoteSavedViews' own header comment
 * (src/components/quotes/quote-saved-views.tsx) for why this one-hop
 * "use client" wrapper is required rather than passing
 * `buildClientHrefFromSavedViewParams` as a prop directly from the
 * (Server Component) Clients page.
 */
export function ClientSavedViews({
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
      surface="clients"
      currentParams={currentParams}
      buildApplyHref={buildClientHrefFromSavedViewParams}
    />
  );
}
