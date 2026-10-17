"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreIcon, CloseIcon } from "@/components/ui/icons";
import { buildSidebarGroups, isActive, type SidebarPermissionFlags } from "./sidebar";
import {
  buildMobileBottomNavItems,
  buildMoreDrawerGroups,
  computeActiveMobileNavKey,
  shouldShowMobileBottomNav,
  MOBILE_MORE_KEY,
} from "@/components/navigation/mobile-nav";

/**
 * Mobile Navigation Foundation (Mobile Improvement Slice A). The mobile
 * replacement for Sidebar's own previous below-`md` horizontal-scroll
 * strip (now `hidden md:flex` — see sidebar.tsx) — this component is
 * `md:hidden` everywhere it renders anything at all, so there is never a
 * width where both the desktop Sidebar and this bottom nav are visible
 * together.
 *
 * `permissions` is the exact same, already-request-scoped
 * `SidebarPermissionFlags` object `(dashboard)/layout.tsx` already
 * builds once for `<Sidebar>` — passed down unchanged, never recomputed
 * or refetched. `buildSidebarGroups(permissions)` is called here too
 * (mirroring Sidebar's own internal call), not duplicated authorization
 * logic: it is the same pure, side-effect-free function given the same
 * already-resolved flags, so calling it a second time is exactly as safe
 * as calling it once — there is still exactly one authorization source
 * (the flags themselves), never two.
 *
 * Four of `buildSidebarGroups`' own ten groups (Home, Clients, Work,
 * Finance) become direct bottom-nav items; the remaining six (Sales,
 * Documents, Support, Insights, Team, Settings) render inside the "More"
 * drawer — see mobile-nav.ts for the exact derivation. No second,
 * hardcoded mobile route tree exists anywhere in this file.
 */
export function MobileNavigation({
  permissions,
  disablePrefetch = false,
}: {
  permissions: SidebarPermissionFlags;
  disablePrefetch?: boolean;
}) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);

  const groups = buildSidebarGroups(permissions);
  const bottomNavItems = buildMobileBottomNavItems(groups);
  const moreGroups = buildMoreDrawerGroups(groups);
  const activeKey = computeActiveMobileNavKey(pathname, bottomNavItems);
  const showBottomNav = shouldShowMobileBottomNav(pathname);

  function openDrawer(): void {
    setIsOpen(true);
    dialogRef.current?.showModal();
  }

  function closeDrawer(): void {
    dialogRef.current?.close();
  }

  // Mobile Improvement audit §28 / this slice's own approved Product
  // decision: the bounded V1 unsaved-change mitigation is to not render
  // the bottom nav (or its own spacer below) at all on a confirmed
  // focused create/edit/duplicate route — never a global navigation
  // interception, and UnsavedChangesScope itself is untouched.
  if (!showBottomNav) {
    return null;
  }

  return (
    <>
      {/*
        A plain, in-flow spacer matching the fixed bar's own height below
        (including its own safe-area reservation) — this is what keeps a
        normal page's last row of content from ever rendering behind the
        bar, without any page needing its own bottom padding. Rendered
        (and removed) in lockstep with the real bar via the exact same
        `showBottomNav` check above, so a focused-form route that hides
        the bar never carries this reserved space either — no unexplained
        blank area.
      */}
      <div
        aria-hidden="true"
        className="h-16 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      />

      <nav
        aria-label="Primary"
        data-testid="mobile-bottom-nav"
        className="border-border-default bg-surface fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {bottomNavItems.map((item) => {
          const active = item.key === activeKey;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              prefetch={disablePrefetch ? false : undefined}
              // flex-1 + the full item area as the target (not a tiny
              // icon-only hit zone) — comfortably exceeds a 44px touch
              // target at any reasonable phone width.
              className={`focus-visible:ring-focus-ring flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                active ? "text-accent" : "text-text-secondary"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={openDrawer}
          className={`focus-visible:ring-focus-ring flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
            activeKey === MOBILE_MORE_KEY ? "text-accent" : "text-text-secondary"
          }`}
        >
          <MoreIcon className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      {/*
        The More drawer — a native <dialog>, matching ConfirmDialog/
        SearchDialog's own proven architecture exactly: free focus trap,
        free Escape-to-close, free backdrop-click-to-close (the explicit
        onClick-on-self check below), free return-focus-to-invoker on
        close. Positioning reuses AIAssistantPanel's own already-shipped
        mobile edge-anchored-drawer classes verbatim (full-height,
        full-width, no internal margin) — this is an established pattern
        in this app, not a new one — with AIAssistantPanel's own `md:`
        desktop-positioning variant simply omitted, since this trigger
        button itself is already `md:hidden` and this dialog is never
        reachable at md+ at all.
      */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setIsOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            dialogRef.current?.close();
          }
        }}
        className="border-border-default bg-surface m-0 h-dvh max-h-none w-full max-w-none border-0 p-0 shadow-xl open:flex open:flex-col backdrop:bg-black/40 md:hidden"
      >
        <div className="border-border-default flex shrink-0 items-center justify-between border-b px-4 py-3">
          <h2 id={titleId} className="text-text-primary text-base font-semibold">
            More
          </h2>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeDrawer}
            className="text-text-secondary focus-visible:ring-focus-ring rounded-md p-1.5 transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <nav
          aria-label="More navigation"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {moreGroups.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.key}>
                <div className="text-text-muted flex items-center gap-2 px-1 pb-1 text-xs font-semibold tracking-wide uppercase">
                  <GroupIcon className="h-3.5 w-3.5" />
                  <span>{group.label}</span>
                </div>
                <ul>
                  {group.links.map((link) => {
                    const active = isActive(pathname, link.href);
                    return (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          aria-current={active ? "page" : undefined}
                          prefetch={disablePrefetch ? false : undefined}
                          onClick={() => {
                            // Deferred a tick — same reasoning
                            // SearchDialog's own result-selection close()
                            // already documents: the click that just
                            // fired is this Link's own navigation-
                            // triggering click, still bubbling through
                            // this same DOM tree. Closing (and
                            // unmounting this subtree) synchronously in
                            // that same tick risks racing Next's own
                            // navigation start; letting it finish first
                            // avoids that race entirely.
                            setTimeout(() => dialogRef.current?.close(), 0);
                          }}
                          className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                            active ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"
                          }`}
                        >
                          {link.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </dialog>
    </>
  );
}
