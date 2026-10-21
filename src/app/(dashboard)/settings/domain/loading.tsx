import { RouteLoadingAnnouncement, PageHeadingSkeleton } from "@/components/ui/page-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * Mirrors DomainSettingsPage's own shell: `mx-auto max-w-3xl px-4 py-8
 * sm:px-6 lg:px-8`, title+subtitle header, generated-subdomain box.
 *
 * Unfinished Features Cleanup (Block 17) — the trailing form-card
 * skeleton is removed alongside the page's own now-deleted custom-domain
 * form; this skeleton must keep mirroring the real page's own shape
 * exactly, or a loading flash would show a placeholder for content that
 * never actually renders.
 */
export default function DomainSettingsLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <RouteLoadingAnnouncement label="Loading domain settings" />
      <PageHeadingSkeleton />
      <div className={`mt-6 p-6 ${CARD_SURFACE_CLASSES}`}>
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="mt-2 h-4 w-48" />
      </div>
    </div>
  );
}
