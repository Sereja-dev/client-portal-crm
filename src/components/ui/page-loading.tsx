import { Skeleton } from "@/components/ui/skeleton";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * Product UI/UX PR 4 — the shared building blocks every new route
 * `loading.tsx` composes from (Product UI/UX Design Investigation,
 * finding F5: Client/Project/Task/Invoice `[id]/edit` pages, Team,
 * Settings/*, and Portal `/profile` had no `loading.tsx` at all — a
 * blank/flash transition, unlike the list pages' existing
 * `ListPageSkeleton`). Each `loading.tsx` still supplies its own real
 * page's outer container className (e.g. `mx-auto max-w-xl`) so the
 * skeleton's layout matches the real page closely enough to reduce
 * layout shift — these are the repeated interior shapes only, not a
 * full templating system.
 *
 * Accessibility: every piece here is decorative (`Skeleton`'s own
 * `aria-hidden="true"`) and renders no focusable/interactive element.
 * The one real, non-hidden announcement per page boundary is
 * `RouteLoadingAnnouncement`, which every new `loading.tsx` renders
 * exactly once.
 */

/** The one real, non-decorative element per loading boundary — visually hidden (`sr-only`, never `aria-hidden`) so it stays in the accessibility tree. */
export function RouteLoadingAnnouncement({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}

/**
 * Navigation Performance Slice A — the bordered-card profile header
 * shared byte-for-byte by ClientProfileHeader and ProjectProfileHeader
 * (`border-border-default bg-surface rounded-lg border p-6`, name+badge
 * row, then a `dl` metadata row) — deliberately mirrored between the two
 * Hub pages per each component's own doc comment. Neither detail Hub had
 * a loading.tsx at all before this slice (the audit's own P1-A finding);
 * this is a dedicated primitive, not ListPageSkeleton, because the real
 * shape is a card+metadata header followed by a tabbed Hub, not a table.
 */
export function DetailHeaderSkeleton() {
  return (
    <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The `mb-6 flex items-center justify-between` title+Cancel/Back header shared by every `[id]/edit` page (Clients/Projects/Tasks/Invoices). */
export function EditPageHeaderSkeleton() {
  return (
    <div className="mb-6 flex items-center justify-between">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-14" />
    </div>
  );
}

/** The stacked title(+subtitle), optional trailing action-button, header shape shared by Team/Settings/Portal Profile. */
export function PageHeadingSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {withAction && <Skeleton className="h-9 w-32" />}
    </div>
  );
}

/** One label-bar + input-bar pair — a single form field's loading placeholder. */
function FieldSkeleton() {
  return (
    <div>
      <Skeleton className="h-3.5 w-20" />
      <Skeleton className="mt-2 h-9 w-full" />
    </div>
  );
}

/**
 * The bordered card (CARD_SURFACE_CLASSES, `p-6`) every edit form,
 * Settings form, and Portal Profile section renders as — optionally with
 * its own in-card heading (Portal Profile's three sections each have
 * one; the four `[id]/edit` pages don't), N field placeholders, and an
 * optional trailing submit-button bar (Portal Profile's read-only
 * sections have no submit control). The real pages this mimics still
 * render their own literal `rounded-lg border border-gray-200 bg-white`
 * (Design System Phase 2 migrates shared primitives only, not yet these
 * page-level call sites — see surface.ts's own doc comment) — this
 * skeleton keeps pace with `Table`/`RecordCard`'s already-migrated look
 * rather than the still-raw pages it mimics, since it is a shared
 * primitive itself.
 */
export function FormCardSkeleton({
  fields = 4,
  heading = false,
  withButton = true,
}: {
  fields?: number;
  heading?: boolean;
  withButton?: boolean;
}) {
  return (
    <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      {heading && <Skeleton className="h-4 w-24" />}
      <div className={heading ? "mt-4 space-y-4" : "space-y-4"}>
        {Array.from({ length: fields }, (_, i) => (
          <FieldSkeleton key={i} />
        ))}
      </div>
      {withButton && <Skeleton className="mt-6 h-9 w-32" />}
    </div>
  );
}

/**
 * A bordered table-shaped block — a thin header strip followed by `rows`
 * rows of `columns` cell placeholders each, matching the same
 * proportions `ListPageSkeleton`
 * (`src/components/ui/list-page-skeleton.tsx`) already uses. Deliberately
 * standalone (not that component's own page-header row) — Team's Members
 * and Pending invitations sections each render their own `<h2>`
 * subheading directly, outside this piece.
 */
export function TableRowsSkeleton({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <div className={`mt-4 overflow-hidden ${CARD_SURFACE_CLASSES}`}>
      <div className="border-border-default bg-surface-recessed h-10 border-b" />
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="border-border-subtle flex items-center gap-6 border-b px-4 py-4 last:border-0">
          {Array.from({ length: columns }, (_, colIndex) => (
            <Skeleton key={colIndex} className="h-4 w-full max-w-24" />
          ))}
        </div>
      ))}
    </div>
  );
}
