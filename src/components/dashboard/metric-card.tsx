import Link from "next/link";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { IconProps } from "@/components/ui/icons";

/**
 * Visual Design Improvement V3 — `icon` is optional and purely additive:
 * MetricCard is also reused by Portal ((app)/page.tsx) and Platform Admin
 * (platform-admin/page.tsx), neither of which passes one today, and
 * neither is touched by this slice — both render exactly as before, byte-
 * for-byte, since the icon container only renders when `icon` is present.
 *
 * Icon treatment is deliberately uniform across every KPI — the same
 * --accent-subtle wash + text-accent stroke color regardless of which
 * metric it is (never a different semantic color per card: "Outstanding
 * invoices" being non-zero is not the same thing as it being overdue —
 * NeedsAttention already carries that urgency elsewhere — so this stays
 * neutral/accent-styled like every other card, never success/warning).
 * Icons are purely decorative: the icon component's own `aria-hidden`
 * (baked into every icons.tsx component already) is the real accessible
 * boundary — `label`/`value`/`hint` remain the only accessible content.
 *
 * Elevation now uses the Design System's own `--aqenra-shadow-sm`/
 * `--aqenra-shadow-md` tokens (globals.css) — defined since an earlier
 * phase but not yet consumed here — for a resting + stronger-on-hover
 * elevation, replacing the previous "no resting shadow at all, hover:
 * shadow-sm only" treatment. Both tokens are already Light/Dark-
 * calibrated (no value changed by this file).
 */
export function MetricCard({
  label,
  value,
  href,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  href: string;
  /** Small caption under the value — e.g. the period a figure is scoped to. */
  hint?: string;
  /** One of the existing icons.tsx components — decorative only, never the sole carrier of meaning. Omitted entirely by callers that don't have a meaningful icon (Portal, Platform Admin). */
  icon?: (props: IconProps) => React.ReactElement;
}) {
  return (
    <Link
      href={href}
      className={`focus-visible:ring-focus-ring block p-5 shadow-[var(--aqenra-shadow-sm)] transition hover:border-border-strong hover:shadow-[var(--aqenra-shadow-md)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${CARD_SURFACE_CLASSES}`}
    >
      <div className="flex items-center gap-2">
        {Icon && (
          <span className="bg-accent-subtle text-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <p className="text-text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      </div>
      <p className="text-text-primary mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        {value}
      </p>
      {hint && <p className="text-text-muted mt-1 text-xs">{hint}</p>}
    </Link>
  );
}
