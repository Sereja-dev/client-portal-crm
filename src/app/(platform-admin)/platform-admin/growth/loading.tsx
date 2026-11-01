import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";
import { RouteLoadingAnnouncement } from "@/components/ui/page-loading";

/**
 * Platform Admin Growth loading state — same ListPageSkeleton +
 * RouteLoadingAnnouncement pairing as the Users and Organizations list
 * pages (title + table shape), with the Growth directory's column count.
 */
export default function PlatformAdminGrowthLoading() {
  return (
    <>
      <RouteLoadingAnnouncement label="Loading growth" />
      <ListPageSkeleton columns={7} />
    </>
  );
}
