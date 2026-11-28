import type { Metadata } from "next";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { getPlatformDashboardData } from "@/lib/platform-admin/queries/platform-dashboard";

export const metadata: Metadata = {
  title: "Platform Dashboard — Platform Admin",
};

/**
 * Sale-Ready Phase C, PR2. Reuses (dashboard)/dashboard/page.tsx's own
 * MetricCard grid convention verbatim — no new visual language. Every
 * number here is a deliberately unscoped, cross-organization read (see
 * getPlatformDashboardData's own doc comment) — the opposite of every
 * other MetricCard usage in this app, which is always scoped to the
 * active organization.
 *
 * No trend chart in this PR — see the Phase C plan's own reasoning:
 * production currently has a handful of organizations, all internal
 * verification artifacts: a chart would be a chart of test data, not a
 * real growth signal. Ships once there's real registration data to chart.
 */
export default async function PlatformAdminDashboardPage() {
  const data = await getPlatformDashboardData(new Date());

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Platform Dashboard</h1>
        <p className="text-text-secondary mt-1 text-sm">
          Organization, subscription, and registration metrics across every tenant.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Organizations" value={data.kpis.organizations} href="/platform-admin/organizations" />
        <MetricCard label="Active trials" value={data.kpis.activeTrials} href="/platform-admin/organizations" />
        <MetricCard label="Free organizations" value={data.kpis.freeOrganizations} href="/platform-admin/organizations" />
        <MetricCard label="Active subscriptions" value={data.kpis.activeSubscriptions} href="/platform-admin/organizations" />
        <MetricCard label="Expired trials" value={data.kpis.expiredTrials} href="/platform-admin/organizations" />
        <MetricCard label="Staff users" value={data.kpis.staffUsers} href="/platform-admin/users" />
        <MetricCard label="Portal users" value={data.kpis.portalUsers} href="/platform-admin/users" />
        <MetricCard label="Clients" value={data.kpis.clients} href="/platform-admin/organizations" />
        <MetricCard label="Projects" value={data.kpis.projects} href="/platform-admin/organizations" />
        <MetricCard label="Tasks" value={data.kpis.tasks} href="/platform-admin/organizations" />
      </div>

      <div>
        <h2 className="text-text-primary text-lg font-semibold tracking-tight">Registrations</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-md">
          <MetricCard label="Today" value={data.registrations.today} href="/platform-admin/organizations" />
          <MetricCard label="Last 7 days" value={data.registrations.last7Days} href="/platform-admin/organizations" />
        </div>
      </div>

      <div>
        <h2 className="text-text-primary text-lg font-semibold tracking-tight">Newest organizations</h2>
        {data.newestOrganizations.length === 0 ? (
          <EmptyState title="No organizations yet" description="New organizations will appear here as they register." />
        ) : (
          <div className={`mt-4 overflow-hidden ${CARD_SURFACE_CLASSES}`}>
            <ul className="divide-border-default divide-y">
              {data.newestOrganizations.map((organization) => (
                <li key={organization.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <p className="text-text-primary text-sm font-medium">{organization.name}</p>
                  <time dateTime={organization.createdAt.toISOString()} className="text-text-muted shrink-0 text-xs">
                    {organization.createdAt.toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
