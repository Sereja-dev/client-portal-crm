import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin/authorization";

const links = [
  { href: "/platform-admin", label: "Dashboard" },
  { href: "/platform-admin/organizations", label: "Organizations" },
  { href: "/platform-admin/users", label: "Users" },
];

/**
 * Sale-Ready Phase C. Deliberately its own route group, not nested under
 * (dashboard) — this guard has no concept of "active organization" and
 * must never gain one (see requirePlatformAdmin's own doc comment). Never
 * imports Sidebar/Header/OrganizationSwitcher: those are tenant concepts
 * with no meaning for a cross-organization tool.
 *
 * requirePlatformAdmin() runs exactly once, here, before any child page —
 * same "guard lives in the layout, not repeated per-page" pattern
 * (dashboard)/layout.tsx already establishes for its own portal-identity
 * guard.
 */
export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email } = await requirePlatformAdmin();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight text-gray-900">
              Platform Admin
            </span>
            <nav aria-label="Platform Admin" className="flex gap-4">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded text-sm text-gray-600 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <span className="text-xs text-gray-500">{email}</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
