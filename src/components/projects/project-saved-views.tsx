"use client";

import { SavedViewsControl } from "@/components/list/saved-views-control";
import { buildProjectHrefFromSavedViewParams } from "@/app/(dashboard)/projects/saved-view";

/**
 * Tables Improvement Slice D2B — thin Project-specific integration of
 * the shared SavedViewsControl. See QuoteSavedViews' own header comment
 * (src/components/quotes/quote-saved-views.tsx) for why this one-hop
 * "use client" wrapper is required rather than passing
 * `buildProjectHrefFromSavedViewParams` as a prop directly from the
 * (Server Component) Projects page.
 */
export function ProjectSavedViews({
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
      surface="projects"
      currentParams={currentParams}
      buildApplyHref={buildProjectHrefFromSavedViewParams}
    />
  );
}
