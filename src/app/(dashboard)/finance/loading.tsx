import { RouteLoadingAnnouncement, PageHeadingSkeleton } from "@/components/ui/page-loading";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Navigation Performance Slice A — mirrors Finance's own shell: plain
 * `<div>` wrapper, title+description header, then a KPI-card grid
 * (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). No dedicated KPI-grid
 * skeleton primitive exists, so this reuses the base `Skeleton` block
 * directly in the same grid shape. Audit's P1-A finding: no loading.tsx
 * existed here at all.
 */
export default function FinanceLoading() {
  return (
    <div>
      <RouteLoadingAnnouncement label="Loading finance overview" />
      <PageHeadingSkeleton />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
