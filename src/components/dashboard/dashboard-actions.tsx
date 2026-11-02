import Link from "next/link";

// Matches every other page's own local PRIMARY_LINK_CLASSES constant
// exactly (e.g. tasks/page.tsx, invoices/page.tsx) — this repo's own
// established per-page convention, never a shared toolbar/button system.
const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

// The same secondary link appearance the Clients list's own Import/Export
// actions use (clients/page.tsx) -- identical padding/size, so click targets
// and wrapping are unchanged; only fill/border/weight differ from primary.
const SECONDARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring border-border-strong bg-surface text-text-primary rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

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
 *
 * First-Time User Experience V2, Slice D -- while the onboarding card is
 * actually rendered, its "Get started" button must be the one clear primary
 * action, so these three are shown with the secondary link appearance
 * instead (`demotedDuringOnboarding`). Presentation only: the labels, hrefs
 * and availability are identical in both states, and nothing is hidden. The
 * flag is decided server-side from the very same shouldRenderOnboardingCard
 * condition the card itself uses; omitted/false keeps the exact primary look.
 */
export function DashboardActions({ demotedDuringOnboarding = false }: { demotedDuringOnboarding?: boolean }) {
  const linkClasses = demotedDuringOnboarding ? SECONDARY_LINK_CLASSES : PRIMARY_LINK_CLASSES;
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/clients/new" className={linkClasses}>
        Add client
      </Link>
      <Link href="/invoices/new" className={linkClasses}>
        Create invoice
      </Link>
      <Link href="/tasks?overdue=true" className={linkClasses}>
        View overdue tasks
      </Link>
    </div>
  );
}
