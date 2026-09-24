import Link from "next/link";

// Matches every other page's own local PRIMARY_LINK_CLASSES constant
// exactly (e.g. tasks/page.tsx, invoices/page.tsx) — this repo's own
// established per-page convention, never a shared toolbar/button system.
const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Dashboard Redesign — the three primary operational quick actions.
 * Plain <Link>s, never a new toolbar/navigation pattern.
 *
 * "Create invoice" links straight to /invoices/new even for a completely
 * empty workspace — that page's own EmptyState ("You need a client
 * first" + its own "Add client" CTA to /clients/new) already handles the
 * zero-client case gracefully, confirmed by direct inspection, not
 * assumed — so no pre-check is needed here.
 *
 * "View overdue tasks" links to the real, exact overdue-filtered Tasks
 * list (?overdue=true — see tasks/query.ts's own buildTaskWhere), never
 * a fabricated or approximate destination.
 */
export function DashboardActions() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/clients/new" className={PRIMARY_LINK_CLASSES}>
        Add client
      </Link>
      <Link href="/invoices/new" className={PRIMARY_LINK_CLASSES}>
        Create invoice
      </Link>
      <Link href="/tasks?overdue=true" className={PRIMARY_LINK_CLASSES}>
        View overdue tasks
      </Link>
    </div>
  );
}
