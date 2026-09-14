/**
 * Reports Phase 2 — rendered by the page itself for a MEMBER identity,
 * mirroring src/components/analytics/analytics-access-denied.tsx exactly
 * (deliberately plain: no CTA, no hint at what's actually on the page).
 * Never rendered by error.tsx — page.tsx catches ReportsAccessError
 * inline, the same "an expected access-control outcome, not an
 * unexpected error" distinction Analytics' own page.tsx documents.
 */
export function ReportsAccessDenied() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div
        role="alert"
        className="border-border-strong bg-surface flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center"
      >
        <h1 className="text-text-primary text-lg font-semibold">Access denied</h1>
        <p className="text-text-secondary mt-2 max-w-sm text-sm">Reports is only available to organization owners and admins.</p>
      </div>
    </div>
  );
}
