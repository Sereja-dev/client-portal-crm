import { Skeleton } from "@/components/ui/skeleton";
import { RouteLoadingAnnouncement } from "@/components/ui/page-loading";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * Platform Admin loading-state completeness (primary tier). Mirrors the
 * real Observability page's own structure: a header (title + "Read-only"
 * badge + description), then its four DetailSection blocks — two render
 * a short bucket list (webhook failures by reason, invoice email
 * failures by status/reason), two render a single large count (stale
 * pending webhook/invoice-email). One generic "a few rows, or one big
 * number" skeleton block covers both real shapes closely enough to
 * avoid a jarring transition without needing to know in advance which
 * of the two a given section will resolve to.
 */
export default function PlatformAdminObservabilityLoading() {
  return (
    <div className="space-y-8">
      <RouteLoadingAnnouncement label="Loading observability data" />

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
      </div>

      {Array.from({ length: 4 }, (_, sectionIndex) => (
        <div key={sectionIndex} className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mb-4 mt-2 h-4 w-full max-w-md" />
          <div className="border-border-default overflow-hidden rounded-md border">
            {Array.from({ length: 3 }, (_, rowIndex) => (
              <div key={rowIndex} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
