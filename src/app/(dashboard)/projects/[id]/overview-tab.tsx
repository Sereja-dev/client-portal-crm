import type { ProjectHealth } from "./profile-query";

/** Minutes -> a compact "Xh Ym" (or "Ym" / "0h") human string — integer minutes only, never a fractional-hour float, matching TimeEntry's own established durationMinutes convention. */
function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function HealthCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border-default bg-surface rounded-lg border p-4">
      <p className="text-text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="text-text-primary mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Project Hub V1 — the Overview tab. Four health cards using the exact
 * canonical semantics `fetchProjectHealth` already establishes (never
 * re-derived here): open tasks, overdue tasks, tracked time (a plain
 * duration string, never a money value), and a linked-invoice COUNT only
 * — never a cross-currency amount sum (Section 13's own explicit
 * invariant; see the Invoices tab for each invoice's own kept-together
 * amount+currency).
 */
export function ProjectOverviewTab({
  description,
  health,
}: {
  description: string | null;
  health: ProjectHealth;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <HealthCard label="Open tasks" value={String(health.openTaskCount)} />
        <HealthCard label="Overdue tasks" value={String(health.overdueTaskCount)} />
        <HealthCard label="Tracked time" value={formatDuration(health.trackedMinutes)} />
        <HealthCard label="Invoices" value={String(health.invoiceCount)} />
      </div>

      {description && (
        <div className="border-border-default bg-surface rounded-lg border p-4">
          <h2 className="text-text-primary text-sm font-semibold">Description</h2>
          <p className="text-text-secondary mt-2 text-sm whitespace-pre-wrap">{description}</p>
        </div>
      )}
    </div>
  );
}
