"use client";

/**
 * Legal Pages Back Navigation Fix. Privacy/Terms previously rendered a
 * hardcoded `<Link href="/">` for "← Back" — a fixed same-origin
 * destination that ignored where the visitor actually came from. Since
 * these pages are reachable both from the separate aqenra.com marketing
 * site and from many places inside app.aqenra.com itself, a fixed "/"
 * link routinely landed the visitor somewhere they never asked to go
 * (app.aqenra.com's own root instead of back to aqenra.com, or instead
 * of back to whichever in-app page linked here).
 *
 * Fix: genuine browser-history navigation via `window.history.back()`.
 * This is deliberately NOT origin-aware in any explicit sense — a tab's
 * joint session history already spans every origin it has visited via
 * normal navigation (aqenra.com -> app.aqenra.com is just one more
 * entry on the same stack), so `history.back()` alone correctly returns
 * to aqenra.com, or to whichever app.aqenra.com page linked here,
 * without this component ever needing to know or hardcode either
 * origin.
 *
 * `history.length > 1` is the fallback-detection heuristic: a freshly
 * opened tab (direct visit, bookmark, or a link opened in a new tab)
 * has no back-entry to return to (`history.back()` would silently do
 * nothing), which this catches and redirects to the public marketing
 * site instead — the "Preferred fallback" the task specifies, since
 * these are public legal pages primarily linked from there. There is no
 * more reliable client-side signal: `document.referrer` only reports
 * who linked here, not whether *this tab's own* history stack has
 * anything to go back to, and is unset for a typed/bookmarked visit
 * regardless. This is a fixed, non-configurable constant — never a
 * query parameter or other visitor-controlled value, so there is no
 * open-redirect surface here.
 */
const MARKETING_FALLBACK_URL = "https://aqenra.com";

const BACK_BUTTON_CLASSES =
  "rounded text-sm text-text-muted hover:text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

export function LegalBackButton() {
  return (
    <button
      type="button"
      className={BACK_BUTTON_CLASSES}
      onClick={() => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = MARKETING_FALLBACK_URL;
        }
      }}
    >
      ← Back
    </button>
  );
}
