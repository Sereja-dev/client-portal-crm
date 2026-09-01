import Link from "next/link";

// Design System Phase 2's own established per-file pattern (see e.g.
// (dashboard)/clients/page.tsx, platform-admin/organizations/page.tsx) for
// a <Link> styled as the page's primary action — mechanically equivalent
// to the previous raw bg-black button.
const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Scoped to this one route segment (Next.js's own nested not-found
 * mechanism — the same one src/app/not-found.tsx already uses at the
 * root, just one level deeper) rather than falling through to the root
 * 404: that page's "Go to dashboard" link and tenant-facing copy don't
 * fit a Platform Admin identity that has no personal organization
 * context to return to.
 */
export default function OrganizationNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-text-muted text-sm font-medium">404</p>
      <h1 className="text-text-primary mt-2 text-2xl font-semibold tracking-tight">Organization not found</h1>
      <p className="text-text-secondary mt-2 max-w-sm text-sm">
        This organization doesn&apos;t exist, or its id is invalid.
      </p>
      <Link href="/platform-admin/organizations" className={`mt-6 ${PRIMARY_LINK_CLASSES}`}>
        Back to Organizations
      </Link>
    </div>
  );
}
