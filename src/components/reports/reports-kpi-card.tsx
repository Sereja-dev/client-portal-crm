import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * Reports Phase 2 — plain (non-link) KPI card, matching
 * src/components/dashboard/metric-card.tsx's exact visual shape (label/
 * value/hint typography and spacing) but without a required destination
 * link: unlike Dashboard's 6 KPIs, not every Reports metric has one
 * obvious single page to send a click to, and the approved Phase 2 scope
 * has no requirement that these be clickable.
 */
export function ReportsKpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  /** Small caption under the value — e.g. the selected period, or (Outstanding only) the fixed "Current outstanding receivables" snapshot notice. */
  hint?: string;
}) {
  return (
    <div className={`p-5 ${CARD_SURFACE_CLASSES}`}>
      <p className="text-text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="text-text-primary mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{value}</p>
      {hint && <p className="text-text-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}
