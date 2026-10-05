import Link from "next/link";

export type QuickFilterChip = {
  label: string;
  /** Already-built target href — toggling behavior (clicking the active chip clears it) is the caller's own responsibility when building this, mirroring Tasks' own identical `QuickFilterChip` precedent (src/app/(dashboard)/tasks/page.tsx) exactly. */
  href: string;
  active: boolean;
};

/**
 * Tables Improvement Slice A — small, reusable quick-filter chip row,
 * extracted from Tasks' own already-proven, hand-rolled `QuickFilterChip`
 * (readiness audit §X/§23: the one existing chip precedent in this app).
 * Deliberately NOT a boolean-expression engine — a plain list of
 * already-built `{label, href, active}` entries, each manipulating the
 * SAME canonical URL/query state the caller's own `SearchFilterBar`
 * dropdown already reads (never a parallel client-only filter state) —
 * this component holds no state of its own at all.
 *
 * Tasks' own chips are left completely untouched by this extraction
 * (Tasks is this slice's precedent, not a rewrite target) — this is a
 * new, independent component Invoices adopts first.
 */
export function QuickFilterChips({ chips, label }: { chips: QuickFilterChip[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="mt-4 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          aria-current={chip.active ? "true" : undefined}
          className={`focus-visible:ring-focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
            chip.active ? "bg-accent text-white" : "bg-surface-recessed text-text-secondary hover:bg-[var(--hover)]"
          }`}
        >
          {chip.label}
        </Link>
      ))}
    </div>
  );
}
