import { RouteLoadingAnnouncement, DetailHeaderSkeleton, TableRowsSkeleton } from "@/components/ui/page-loading";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Navigation Performance Slice A — mirrors clients/[id]/loading.tsx's own
 * reasoning: ProjectProfileHeader is the byte-for-byte same card shape as
 * ClientProfileHeader (now DetailHeaderSkeleton), then TabNav's own
 * `mt-6 border-b` row, then the active tab's content. Audit's P1-A
 * finding: this Hub page had no loading.tsx at all.
 */
export default function ProjectDetailLoading() {
  return (
    <div>
      <RouteLoadingAnnouncement label="Loading project" />
      <DetailHeaderSkeleton />
      <div className="border-border-default mt-6 border-b">
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="mt-6">
        <TableRowsSkeleton columns={4} rows={3} />
      </div>
    </div>
  );
}
