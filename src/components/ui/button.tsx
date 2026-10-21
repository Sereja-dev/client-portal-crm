import { ButtonHTMLAttributes } from "react";
import { SpinnerIcon } from "@/components/ui/icons";

/**
 * Two mutually exclusive, non-overlapping class sets — never combined with
 * a caller's own color-override className. A caller that instead appended
 * "bg-white text-gray-900 ..." on top of this component's own hardcoded
 * "bg-black ... text-white" produced a genuine, reproduced production bug:
 * Tailwind's own generated stylesheet order (which utility "wins" a
 * same-specificity conflict) is a build-time/content-scan-order detail,
 * not something a className string's own left-to-right order controls —
 * confirmed directly, this resolved to bg-white winning for
 * background-color while the base text-white still won for color,
 * rendering literally invisible white-on-white button text (see Invoice
 * System Slice 4 post-deploy correction — the reported "empty rectangle"
 * Issue/Send buttons). `variant` sidesteps the whole class of bug
 * structurally: exactly one variant's own class string is ever rendered,
 * so the two rule sets can never both be present to conflict at all.
 * Default (`primary`) is byte-identical to this component's previous sole
 * appearance, so no existing caller's rendered output changes.
 */
const VARIANT_CLASSES = {
  // Aqenra brand PR 2 — bg-black/hover:bg-gray-800 replaced with the
  // approved Aqenra Indigo accent tokens (globals.css). Everything else
  // about this variant (white text, sizing, disabled/loading behavior,
  // the shared focus-visible ring below) is unchanged.
  primary: "bg-accent text-white hover:bg-accent-hover",
  // Design System Phase 2 — border-gray-300/bg-white/text-gray-900 replaced
  // with semantic tokens so this variant renders correctly on Dark's own
  // surface (border-strong/bg-surface preserve the exact same relative
  // weight border-gray-300/bg-white had in Light). hover:bg-[var(--hover)]
  // — not a Tailwind bg-hover utility — matches the established
  // Appearance selector convention (--hover is deliberately not mirrored
  // into @theme inline; see globals.css).
  secondary: "border border-border-strong bg-surface text-text-primary hover:bg-[var(--hover)]",
  // text-danger (not a literal red) is safe here: it's a TEXT color, not
  // a solid white-on-fill button background — --danger is specifically
  // calibrated to stay legible as text/an outline on both Light and Dark
  // surfaces (see globals.css's own Dark SEMANTIC comment). hover uses
  // danger-subtle, the token's own designed "wash over an opaque surface"
  // pairing (the same pattern StatusBadge already relies on).
  dangerOutline: "border border-border-strong bg-surface text-danger hover:bg-danger-subtle",
  // Visual Design Improvement V1 — low-emphasis action: no resting
  // background/border at all (a true "ghost"), text-text-secondary
  // matching the same resting weight Sidebar's own inactive links
  // already use. hover:bg-[var(--hover)] is the identical wash
  // secondary/Sidebar/Appearance-selector already rely on — never a new
  // hover token. The shared focus-visible ring and disabled treatment
  // below (common to every variant) are untouched, so this needs nothing
  // variant-specific for either.
  ghost: "text-text-secondary hover:bg-[var(--hover)]",
  // Visual Design Improvement V1 — a SOLID destructive action (the
  // ConfirmDialog migration below is this variant's first consumer).
  // Deliberately NOT --danger/--danger-subtle: those are calibrated as a
  // text/border color, not a white-on-fill button background (Dark's
  // --danger is a light coral — white text on it fails contrast, see
  // dangerOutline's own comment above). --danger-button/-hover are two
  // new, dedicated tokens (globals.css) calibrated the same way every
  // other semantic pair in this app already is: measured against the
  // exact WCAG relative-luminance formula, white-on-fill, in both
  // themes. text-inverse (not a literal white) is the same "text on a
  // vivid solid fill" role globals.css's own Dark SEMANTIC comment
  // already documents for primary's white text.
  danger: "bg-danger-button text-text-inverse hover:bg-danger-button-hover",
} as const;

export type ButtonVariant = keyof typeof VARIANT_CLASSES;

export function Button({
  className = "",
  variant = "primary",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <SpinnerIcon className="h-4 w-4" />}
      {children}
    </button>
  );
}
