import { RouteLoadingAnnouncement, PageHeadingSkeleton } from "@/components/ui/page-loading";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Navigation Performance Slice A — Calendar's month-grid body has no
 * existing shared skeleton primitive (unlike list/edit/settings pages),
 * so this reuses the same base `Skeleton` block every other skeleton in
 * the app is already built from, sized to roughly occupy the grid's own
 * footprint — not a new visual system, just this primitive at a larger
 * size. Audit's P1-A finding: no loading.tsx existed here at all.
 */
export default function CalendarLoading() {
  return (
    <div>
      <RouteLoadingAnnouncement label="Loading calendar" />
      <PageHeadingSkeleton />
      <Skeleton className="mt-6 h-[560px] w-full" />
    </div>
  );
}
