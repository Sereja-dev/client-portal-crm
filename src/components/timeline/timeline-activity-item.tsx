import { relativeTime } from "@/lib/notifications/relative-time";
import type { ActivityDisplayModel } from "@/lib/activity/format-activity";

/**
 * Communication Timeline Phase 2 — one canonical Activity row, rendered
 * through the existing, safe formatter output only (ActivityDisplayModel
 * — see src/lib/activity/format-activity.ts) — this component never
 * receives or interprets raw Activity.metadata itself, matching
 * src/app/(dashboard)/activity/page.tsx's own row markup closely (same
 * actor + action + optional "Deleted" badge + relative time + detail
 * lines shape), just without that page's own date-grouping (a single
 * entity's own history is short enough not to need it).
 */
export function TimelineActivityItem({ display }: { display: ActivityDisplayModel }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-text-primary min-w-0 text-sm">
          <span className="font-medium">{display.actorLabel}</span> {display.actionLabel}
          {display.isDeleted && (
            <span className="bg-surface-muted text-text-muted ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
              Deleted
            </span>
          )}
        </p>
        <time
          dateTime={display.timestamp.toISOString()}
          title={display.timestamp.toLocaleString()}
          className="text-text-muted shrink-0 text-xs"
        >
          {relativeTime(display.timestamp)}
        </time>
      </div>
      {display.detailLines.map((line, index) => (
        <p key={index} className="text-text-muted mt-1 text-xs">
          {line}
        </p>
      ))}
    </li>
  );
}
