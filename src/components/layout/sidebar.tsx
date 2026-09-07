"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/config/site";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/clients", label: "Clients" },
  { href: "/projects", label: "Projects" },
  { href: "/tasks", label: "Tasks" },
  { href: "/invoices", label: "Invoices" },
  { href: "/team", label: "Team" },
  { href: "/activity", label: "Activity" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings/notifications", label: "Settings" },
  { href: "/settings/billing", label: "Billing" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ disablePrefetch = false }: { disablePrefetch?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      // Design System Phase 2 — bg-surface-recessed: globals.css's own
      // token comment names "sidebar" as one of surface-recessed's
      // intended consumers (the Round 3 "quiet, recessed chrome" tier,
      // one step back from the main bg-background content area).
      className="border-border-default bg-surface-recessed flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:w-56 md:flex-col md:gap-1.5 md:border-r md:border-b-0 md:p-4"
    >
      <span className="text-text-primary hidden px-2 pb-4 text-lg font-semibold tracking-tight md:block">
        {siteConfig.name}
      </span>
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            // Prefetch is only ever active against a real production build
            // (next start) — which is exactly how the E2E suite runs the
            // app. Against the single-connection PGlite backend those
            // tests share (see src/lib/prisma.ts), a background prefetch
            // for one of these links can queue behind — or get abandoned
            // mid-flight by a test's own navigation, permanently jamming
            // — the one shared query queue. Disabling it only in
            // TEST_MODE (never in a real deployment) removes that whole
            // class of intermittent E2E hangs.
            prefetch={disablePrefetch ? false : undefined}
            // Aqenra brand PR 2 — active-state bg-black replaced with the
            // approved Aqenra Indigo accent token (globals.css).
            // Design System Phase 2 — the focus ring and inactive-link
            // colors below (previously ring-black/text-gray-700/
            // hover:bg-gray-100, the "deliberately deferred normalization"
            // this PR's own audit picked up) now use the same semantic
            // tokens the active state already did.
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
              active ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
