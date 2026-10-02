import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import type { ProjectTimeEntryRow } from "./profile-query";
import { PROJECT_TAB_ROW_BOUND } from "./profile-query";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Project Hub V1 — the Time tab. Non-archived entries only, same scope as
 * the Overview's own tracked-time aggregate (profile-query.ts's
 * fetchProjectHealth/fetchProjectTimeEntries). No new time-accounting
 * semantics — each row's own existing fields, no re-derived reporting
 * metric (read-only audit §14's own explicit instruction).
 */
export function ProjectTimeTab({
  projectId,
  entries,
}: {
  projectId: string;
  entries: ProjectTimeEntryRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={`/time/new?projectId=${projectId}`} className={PRIMARY_LINK_CLASSES}>
          Log time
        </Link>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No time logged yet"
          description="Track hours against this project's own tasks as work happens."
          action={
            <Link href={`/time/new?projectId=${projectId}`} className={PRIMARY_LINK_CLASSES}>
              Log time
            </Link>
          }
        />
      ) : (
        <ul className="divide-border-subtle border-border-default divide-y rounded-lg border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-text-primary text-sm font-medium">
                  {formatDateOnlyForDisplay(entry.workDate)} — {formatDuration(entry.durationMinutes)}
                  {!entry.billable && <span className="text-text-muted"> · Non-billable</span>}
                </p>
                <p className="text-text-secondary mt-1 text-xs">
                  {entry.user?.name ?? "—"}
                  {entry.task && ` · ${entry.task.title}`}
                  {entry.description && ` · ${entry.description}`}
                </p>
              </div>
              <Link href={`/time/${entry.id}`} className="text-accent text-sm hover:underline">
                View
              </Link>
            </li>
          ))}
        </ul>
      )}

      {entries.length === PROJECT_TAB_ROW_BOUND && (
        <p className="text-text-muted text-xs">
          Showing the most recent {PROJECT_TAB_ROW_BOUND} entries.{" "}
          <Link href={`/time?projectId=${projectId}`} className="text-accent hover:underline">
            See all time for this project
          </Link>
          .
        </p>
      )}
    </div>
  );
}
