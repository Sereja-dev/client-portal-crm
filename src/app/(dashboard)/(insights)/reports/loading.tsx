import { Skeleton } from "@/components/ui/skeleton";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/** Reports Phase 2 — matches ReportsPage's real layout (header+filters, 6 KPI cards, 4 sections), same shape as src/components/analytics/analytics-skeleton.tsx's own precedent. */
export default function ReportsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`p-5 ${CARD_SURFACE_CLASSES}`}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-16" />
            </div>
          ))}
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`p-6 ${CARD_SURFACE_CLASSES}`}>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-4 h-40 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
