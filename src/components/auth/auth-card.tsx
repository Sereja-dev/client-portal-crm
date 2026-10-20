import type { ReactNode } from "react";
import { siteConfig } from "@/config/site";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * Sale-Ready Phase E, S1.1 (P0). Shared presentational shell for every
 * staff auth page (login/signup/forgot-password/reset-password) —
 * previously each page duplicated the exact same unbranded
 * `<main>bg-gray-50<div>card</div></main>` wrapper with no product
 * identity anywhere on the page, so a buyer's very first screen carried
 * zero branding. Purely presentational: no auth logic, no new routes, no
 * behavior change — each page still owns its own heading/copy/form as
 * `children`, exactly as before, just wrapped in this shell instead of
 * duplicating it. `siteConfig` is the same existing branding source
 * `src/app/layout.tsx`'s own `<title>`/description already reads from —
 * not a new abstraction.
 *
 * Accessibility Improvement A4 — this shell was the one remaining
 * theme-invariant surface in the app: its literal `bg-gray-50`/
 * `text-gray-900`/`border-gray-200`/`bg-white` never responded to
 * `data-theme`, so a returning user with Dark selected who logs out and
 * revisits any of these four routes saw the one surface forced back to
 * Light. Migrated to the exact same shell/card pairing Portal's own
 * login/signup pages already ship in Production
 * (`bg-surface-recessed` outer shell, `CARD_SURFACE_CLASSES` card) —
 * reusing an already-proven pattern rather than making a new design
 * decision. `bg-surface` (`CARD_SURFACE_CLASSES`'s own background) is
 * `var(--background)` in Light, i.e. literally `#ffffff` — the same
 * value `bg-white` already resolved to, so the card itself is visually
 * unchanged in Light; `border-border-default` is literally `#E5E7EB`,
 * the same hex `border-gray-200` already was. Only the outer shell
 * (`bg-gray-50` `#F9FAFB` -> `bg-surface-recessed` `#F5F5F7`) and the
 * brand text (`text-gray-900` `#111827` -> `text-text-primary`
 * `#171717`) shift by a few, visually negligible RGB units in Light —
 * see this slice's own audit for the full before/after contrast table.
 */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="bg-surface-recessed flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <span className="text-text-primary text-lg font-semibold tracking-tight">{siteConfig.name}</span>
      <div className={`w-full max-w-sm p-8 shadow-sm ${CARD_SURFACE_CLASSES}`}>{children}</div>
    </main>
  );
}
