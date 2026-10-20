/**
 * Design System Phase 2 — the one shared class-string builder for
 * Input/Select/Textarea. Before this, all three files hand-maintained
 * byte-identical copies of the same raw-Tailwind class string (confirmed
 * via direct comparison during the Phase 2 primitive audit) — this
 * consolidates that triplication into one definition rather than
 * migrating three separate copies to semantic tokens and risking them
 * silently drifting apart later.
 *
 * Semantic-token mapping (see globals.css for each token's Light/Dark
 * value): bg-surface is the control's own opaque fill (never bg-white,
 * so it renders correctly on Dark's own surface tokens); placeholder/
 * disabled text use --text-muted/--disabled respectively. Invalid state
 * uses --danger for border+ring — a text/border color, not a solid
 * white-on-fill button color, so it's safe to use directly (see this
 * PR's own audit notes on why --danger must NOT be used as a solid
 * button fill in Dark).
 *
 * Accessibility Improvement A3+A5 — two corrections to the resting/focus
 * treatment, both confirmed by direct WCAG contrast calculation (see
 * each token's own comment in globals.css):
 *  - the resting (valid, unfocused) border now uses the dedicated
 *    --border-form-control token instead of --border-strong, which
 *    measured well under WCAG 1.4.11's 3:1 minimum for identifying a
 *    field's own boundary in both Light (~1.47:1) and Dark (~2.05:1) —
 *    --border-strong itself is deliberately left untouched (60+
 *    unrelated consumers across buttons/dialogs/cards/error pages share
 *    it; this is a new, form-control-only token, not a global change).
 *  - focus now uses focus-visible: (not focus:) throughout, so a plain
 *    mouse click no longer shows the full prominent ring the same way
 *    keyboard focus does (standard caveat: browsers still treat
 *    focus-visible as matching after a click specifically for
 *    text-entry controls — this is expected, accepted browser behavior,
 *    not something this change fights), widened from ring-1 to ring-2
 *    with a ring-offset-2, matching Button's own established ring
 *    width/offset — while deliberately keeping --accent/--danger (not
 *    --focus-ring) as the ring/border color, preserving the form
 *    control's own existing border-color-swap-on-focus micro-interaction
 *    unchanged in color, only in mechanism. Both the ring and the
 *    border-color swap stay gated on the same focus-visible: pseudo-
 *    class, in both the valid and invalid branches, so neither state
 *    ever mixes a focus: half with a focus-visible: half.
 */
export function formControlClasses(invalid: boolean): string {
  return `mt-1 block w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary shadow-sm placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-[var(--disabled)] ${
    invalid
      ? "border-danger focus-visible:border-danger focus-visible:ring-danger"
      : "border-border-form-control focus-visible:border-accent focus-visible:ring-accent"
  }`;
}
