"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InboxIcon } from "@/components/ui/icons";

/**
 * Dashboard-navigation hardening (post-audit) — a Staff-app-scoped 404,
 * rendered inside (dashboard)/layout.tsx (Sidebar/Header still present)
 * for any `notFound()` call under this route group (e.g. Leads/Clients/
 * Settings edit pages scoped by id+organizationId) that previously fell
 * through to the global src/app/not-found.tsx instead — a marketing-site
 * page whose only action is "Go to dashboard," which is exactly the
 * "every Staff-side 404 funnels into a misleading Dashboard-only
 * recovery path" the audit flagged. That global page is untouched here;
 * this is a separate, additive file matched by Next.js's own most-
 * specific-segment `not-found.tsx` resolution.
 *
 * Deliberately does not diagnose *why* the page wasn't found (a
 * genuinely deleted/foreign-org record vs. a stale cached reference from
 * before a deployment look identical to this boundary) — it offers a
 * neutral explanation covering both, and three real recovery paths
 * (refresh, go back, a safe list route) rather than a single forced
 * detour through Dashboard.
 */
export default function DashboardNotFound() {
  const router = useRouter();

  return (
    <div className="border-border-strong bg-surface mt-10 flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <InboxIcon className="text-text-muted h-10 w-10" />
      <p className="text-text-primary mt-4 text-sm font-medium">Page not found</p>
      <p className="text-text-muted mt-1 max-w-sm text-sm">
        This page couldn&apos;t be found. It may have been moved or removed, or the page you had
        open may be out of date after a recent update — refreshing usually fixes that.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {/*
          A real browser reload, not router.refresh(): router.refresh()
          only re-fetches this route's own RSC payload using the CLIENT'S
          own already-loaded JS bundle — if that bundle itself is the
          stale thing (an older deployment's build, the exact "Failed to
          find Server Action" class of issue this hardening targets), a
          soft refresh can't fix it. A full reload fetches the current
          deployment's HTML/JS from scratch, which does.
        */}
        <Button type="button" onClick={() => window.location.reload()}>
          Refresh this page
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Go back
        </Button>
        <Link
          href="/dashboard"
          className="focus-visible:ring-focus-ring text-text-secondary hover:text-text-primary rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
