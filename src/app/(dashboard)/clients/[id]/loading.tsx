import { RouteLoadingAnnouncement, DetailHeaderSkeleton, TableRowsSkeleton } from "@/components/ui/page-loading";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Navigation Performance Slice A — mirrors the real page's own shell:
 * ClientProfileHeader (now DetailHeaderSkeleton, the shared bordered-card
 * profile-header shape), then TabNav's own `mt-6 border-b` row, then the
 * active tab's content. Audit's P1-A finding: this Hub page had no
 * loading.tsx at all.
 */
export default function ClientDetailLoading() {
  return (
    <div>
      <RouteLoadingAnnouncement label="Loading client" />
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
