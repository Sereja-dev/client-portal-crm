import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Platform Dashboard — Platform Admin",
};

/**
 * Sale-Ready Phase C, PR1 (Foundation). Guard-only shell — the real KPI
 * grid (organizations, trials, subscriptions, staff/portal users,
 * registrations) ships in PR2, reusing the (dashboard)/dashboard/query.ts
 * pattern. Rendering an honest "not built yet" state here rather than
 * fake numbers, same discipline the Legal Foundation pages shipped with.
 */
export default function PlatformAdminDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Platform Dashboard</h1>
      <p className="mt-1 text-sm text-gray-600">
        Organization, subscription, and registration metrics across every tenant.
      </p>
      <EmptyState
        title="Not built yet"
        description="Platform-wide KPIs ship in the next PR (Sale-Ready Phase C, PR2)."
      />
    </div>
  );
}
