import Link from "next/link";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { UpcomingOrOverdueTask, TodayCalendarEvent } from "@/app/(dashboard)/dashboard/query";

const itemLinkClass =
  "text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Dashboard Redesign — the operational "Today" section: tasks due today
 * plus today's calendar events, side by side on desktop, stacked on
 * mobile. Each half shows its own small, non-oversized empty state when
 * its own list is empty — never a combined empty state here (unlike
 * Needs Attention, this task's own spec only asks for that collapsing
 * behavior there).
 */
export function TodaySection({
  tasks,
  events,
}: {
  tasks: UpcomingOrOverdueTask[];
  events: TodayCalendarEvent[];
}) {
  return (
    <div>
      <h2 className="text-text-primary text-lg font-semibold tracking-tight">Today</h2>
      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <h3 className="text-text-primary mb-4 text-sm font-semibold">Tasks due today</h3>
          {tasks.length === 0 ? (
            <p className="text-text-muted text-sm">No tasks due today.</p>
          ) : (
            <ul className="divide-border-default divide-y">
              {tasks.map((task) => (
                <li key={task.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/tasks/${task.id}/edit`} className={itemLinkClass}>
                    {task.title}
                  </Link>
                  <p className="text-text-muted text-sm">{task.projectName}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <h3 className="text-text-primary mb-4 text-sm font-semibold">Today&rsquo;s events</h3>
          {events.length === 0 ? (
            <p className="text-text-muted text-sm">No events today.</p>
          ) : (
            <ul className="divide-border-default divide-y">
              {events.map((event) => (
                <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href="/calendar" className={itemLinkClass}>
                    {event.title}
                  </Link>
                  <p className="text-text-muted text-sm">{event.allDay ? "All day" : event.displayTime}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
