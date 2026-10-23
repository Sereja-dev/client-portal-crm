import { RouteLoadingAnnouncement } from "@/components/ui/page-loading";
import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/**
 * Navigation Performance Slice A — Contracts is a record list
 * (ListPageSkeleton already renders its own title+action header, same
 * precedent as clients/loading.tsx, invoices/loading.tsx). Audit's P1-A
 * finding: no loading.tsx existed here at all.
 *
 * This boundary gives the nested dynamic contracts/[id] route an
 * inherited Suspense boundary too (it has no loading.tsx of its own) —
 * confirmed, via a dedicated security audit, to be the documented Next.js
 * streaming/notFound() characteristic (a streamed not-found response
 * keeps its already-committed 200 status) rather than any tenant-
 * isolation defect: foreign-org content is never rendered, server-side
 * authorization and query scoping are unaffected. Accepted as-is for
 * this slice — see that audit's own report for the full analysis.
 */
export default function ContractsLoading() {
  return (
    <div>
      <RouteLoadingAnnouncement label="Loading contracts" />
      <ListPageSkeleton columns={6} />
    </div>
  );
}
