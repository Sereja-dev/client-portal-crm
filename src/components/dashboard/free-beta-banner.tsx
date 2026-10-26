"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { readFreeBetaBannerDismissed, writeFreeBetaBannerDismissed } from "@/lib/free-beta-banner/storage";

/**
 * Per-user cached client snapshot — exists ONLY to satisfy
 * `useSyncExternalStore`'s own referential-stability contract, the same
 * need `use-table-columns.ts`'s own `snapshotCache` already has:
 * `readFreeBetaBannerDismissed()` is a plain boolean (not a fresh array
 * each call, so this isn't strictly required for reference equality),
 * but the cache still avoids a redundant localStorage read on every
 * render and keeps this hook's shape identical to that proven
 * precedent. Populated lazily, once per user, and the ONLY thing read
 * on every subsequent render until a real dismiss explicitly replaces
 * it — never written to from inside an effect body.
 */
const snapshotCache = new Map<string, boolean>();

/** No live subscription by design — this banner has no cross-tab sync, matching Table Columns/Saved Views' own identical choice. The only real update this component ever produces flows through its own `override` state below, set directly from the dismiss button's event handler, never through this store's own notify path. */
function subscribeNoop(): () => void {
  return () => {};
}

/**
 * Hydration safety (same reasoning as Table Columns/Saved Views):
 * `useSyncExternalStore` renders this stable `false` ("not dismissed
 * yet" — the same default a fresh browser with no stored preference
 * would produce) during SSR and the FIRST client render, so hydration
 * can never mismatch the server-rendered markup. The real stored
 * dismissal is only read once React swaps to the real client snapshot
 * immediately after mount. A brief post-mount disappearance of an
 * already-dismissed banner is the explicitly accepted tradeoff this
 * codebase already documents twice for the identical pattern.
 */
function getServerSnapshot(): boolean {
  return false;
}

const TITLE = "Aqenra is in Public Beta";
const BODY =
  "Aqenra is currently in public beta. We're actively improving the platform, so some features may change or be updated. Thanks for being an early user!";

/**
 * Free Public Beta — Welcome Banner. Rendered only by the Dashboard page
 * itself (never the shared (dashboard)/layout.tsx — see that page's own
 * comment on why), and only when the caller has already resolved
 * `isFreeBetaModeEnabled()` server-side — this component has no idea the
 * flag exists at all, it only ever renders based on its own dismissal
 * state once mounted. `userId` is the only identity this component ever
 * receives — never an email, session token, or anything else about the
 * user — and it's used purely as a localStorage key scope (`@/lib/free-
 * beta-banner/storage.ts`), never sent anywhere.
 *
 * Deliberately not coupled to `BillingNotice`/`NoticeBanner` (a Billing-
 * specific type this notice has nothing to do with) and deliberately not
 * a reuse of `PortalWelcomeBanner` (whose dismiss is intentionally
 * NON-persistent, the opposite of what this notice needs) — a small,
 * independent component is the correct minimal shape here, following
 * each precedent's relevant half rather than forcing an ill-fitting
 * reuse of either.
 */
export function FreeBetaBanner({ userId }: { userId: string }) {
  const getClientSnapshot = useCallback((): boolean => {
    const cached = snapshotCache.get(userId);
    if (cached !== undefined) return cached;
    const fresh = readFreeBetaBannerDismissed(userId);
    snapshotCache.set(userId, fresh);
    return fresh;
  }, [userId]);

  const externalDismissed = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);

  // Authoritative once set, exactly like `use-table-columns.ts`'s own
  // `override` — the dismiss click below writes here, from a genuine
  // event-handler call site, never a bare effect body, so the banner
  // disappears immediately on click rather than waiting on a second
  // external-store notification that will never arrive (subscribeNoop).
  const [override, setOverride] = useState<boolean | null>(null);
  const dismissed = override ?? externalDismissed;

  const handleDismiss = useCallback(() => {
    // A storage write failure (caught inside writeFreeBetaBannerDismissed,
    // never thrown here) must never block dismissing the banner for the
    // current mounted session — `setOverride` below always runs
    // regardless of the write's own result.
    writeFreeBetaBannerDismissed(userId, true);
    snapshotCache.set(userId, true);
    setOverride(true);
  }, [userId]);

  if (dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-md border border-info bg-info-subtle px-4 py-3 text-sm text-info"
    >
      <p>
        <span className="font-semibold">{TITLE}</span>
        <span className="mx-1.5" aria-hidden="true">
          ·
        </span>
        <span>{BODY}</span>
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss beta notice"
        className="text-text-muted focus-visible:ring-focus-ring shrink-0 rounded p-1 hover:text-text-secondary focus:outline-none focus-visible:ring-2"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
