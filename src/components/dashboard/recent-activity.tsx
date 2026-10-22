import Link from "next/link";
import type { ActivityDisplayModel } from "@/lib/activity/format-activity";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";

/**
 * Compact preview of the Activity Timeline — reuses formatActivity()'s
 * already-computed display model (actorLabel/actionLabel/isDeleted/etc.)
 * as-is, no separate formatting logic. Deliberately not the full Timeline
 * UI: no day-grouping, no filters, no pagination — just the latest few
 * events with a link to the real page for anything more.
 */
export function RecentActivity({ items }: { items: { id: string; display: ActivityDisplayModel }[] }) {
  return (
    <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <div className="flex items-center justify-between">
        {/*
          Dashboard heading hierarchy fix — this section is a direct
          sibling of NeedsAttention's/TodaySection's own <h2> (all three
          are direct children of the same Dashboard page.tsx wrapper, no
          intervening parent heading), not nested under anything. <h3>
          was correct when this sat alongside three other h3-level peer
          widgets under an h2 "Breakdowns" section (pre-"Redesign
          dashboard workspace"); that commit removed those peers and the
          h2 "Breakdowns" context, introducing today's h2-level
          NeedsAttention/TodaySection siblings, but left this file
          untouched — orphaning it at the wrong level. Semantic-only:
          className/copy/layout are unchanged.
        */}
        <h2 className="text-text-primary text-sm font-semibold">Recent activity</h2>
        <Link href="/activity" className={ACTION_LINK_CLASSES}>
          View all activity
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-text-muted mt-4 text-sm">No activity yet.</p>
      ) : (
        <ul className="divide-border-subtle mt-4 divide-y">
          {items.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <p className="text-text-primary text-sm">
                  <span className="font-medium">{item.display.actorLabel}</span> {item.display.actionLabel}
                  {item.display.isDeleted && (
                    <span className="bg-surface-muted text-text-muted ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                      Deleted
                    </span>
                  )}
                </p>
                <time
                  dateTime={item.display.timestamp.toISOString()}
                  className="text-text-muted shrink-0 text-xs"
                >
                  {item.display.timestamp.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </div>
              {item.display.detailLines.map((line, index) => (
                <p key={index} className="text-text-muted mt-0.5 text-xs">
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
