import { RouteLoadingAnnouncement } from "@/components/ui/page-loading";
import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/**
 * Navigation Performance Slice A — mirrors Time's own shell: `mx-auto
 * max-w-6xl px-4 py-8 sm:px-6 lg:px-8`, then its record list.
 * ListPageSkeleton already renders its own title+action header (same
 * precedent as clients/loading.tsx, invoices/loading.tsx) — nothing
 * extra is stacked in front of it. Audit's P1-A finding: no loading.tsx
 * existed here at all.
 */
export default function TimeLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <RouteLoadingAnnouncement label="Loading time entries" />
      <ListPageSkeleton columns={5} />
    </div>
  );
}
