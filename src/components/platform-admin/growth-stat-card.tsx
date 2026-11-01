import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * Platform Admin Growth V1. A non-link sibling of components/dashboard/
 * metric-card.tsx (which is always an anchor) with the same card surface
 * and type scale. `hint` carries the definition or caveat that keeps one
 * figure from being read as another.
 */
export function GrowthStatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className={`p-5 shadow-[var(--aqenra-shadow-sm)] ${CARD_SURFACE_CLASSES}`}>
      <p className="text-text-secondary text-sm font-medium">{label}</p>
      <p className="text-text-primary mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-text-muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}
