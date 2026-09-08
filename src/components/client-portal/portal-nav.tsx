"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/projects", label: "Projects" },
  { href: "/portal/quotes", label: "Quotes" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/profile", label: "Profile" },
];

// "/portal" itself must only be active on an exact match — every other
// portal route also starts with "/portal", so a plain startsWith check
// (same as the staff Sidebar's isActive) would keep Overview highlighted
// everywhere.
function isActive(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Design System Phase 2 — migrated in lockstep with
 * src/components/settings/settings-nav.tsx (which mirrors this
 * component's shape exactly): the Aqenra Indigo accent sweep PR #139
 * deliberately deferred for both of these secondary navs is completed
 * here, using the same semantic tokens both now share.
 */
export function PortalNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Client Portal"
      className="border-border-subtle flex gap-1 overflow-x-auto border-t px-4 py-2 sm:px-6"
    >
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`focus-visible:ring-focus-ring whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
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
