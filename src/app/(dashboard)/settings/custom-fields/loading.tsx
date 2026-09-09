import { RouteLoadingAnnouncement, PageHeadingSkeleton, TableRowsSkeleton } from "@/components/ui/page-loading";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors CustomFieldsSettingsPage's own shell: `mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8`, title+subtitle header, entity tabs strip, then the definitions table. */
export default function CustomFieldsSettingsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <RouteLoadingAnnouncement label="Loading custom fields" />
      <PageHeadingSkeleton />
      <Skeleton className="mt-6 h-10 w-64 rounded-lg" />
      <TableRowsSkeleton columns={4} rows={3} />
    </div>
  );
}
