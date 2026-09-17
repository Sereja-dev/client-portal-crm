import Link from "next/link";

const TABS: { value: "month" | "agenda" | "archived"; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "agenda", label: "Agenda" },
  { value: "archived", label: "Archived" },
];

/**
 * Calendar V1 §1/§22 — plain query-param view switcher, matching this
 * app's own established list-filter-tab convention (e.g. Portal
 * Invoices' own FILTER_TABS) rather than any new nav architecture. Only
 * `view` is ever read; Month's own `?y=&m=` navigation is handled
 * separately (see month-nav-links.tsx), never mixed into this row.
 */
export function CalendarViewTabs({ active }: { active: "month" | "agenda" | "archived" }) {
  return (
    <div className="flex gap-1">
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        const href = tab.value === "month" ? "/calendar" : `/calendar?view=${tab.value}`;
        return (
          <Link
            key={tab.value}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              isActive ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
