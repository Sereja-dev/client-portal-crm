import { RouteLoadingAnnouncement } from "@/components/ui/page-loading";
import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/**
 * Navigation Performance Slice A — Quotes is a record list (ListPageSkeleton
 * already renders its own title+action header, same precedent as clients/
 * loading.tsx, invoices/loading.tsx). Audit's P1-A finding: no loading.tsx
 * existed here at all.
 */
export default function QuotesLoading() {
  return (
    <div>
      <RouteLoadingAnnouncement label="Loading quotes" />
      <ListPageSkeleton columns={6} />
    </div>
  );
}
