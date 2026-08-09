import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Organizations — Platform Admin",
};

/**
 * Sale-Ready Phase C, PR1 (Foundation). Guard-only shell — the real
 * paginated list + per-organization detail drill-down ships in PR3.
 */
export default function PlatformAdminOrganizationsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Organizations</h1>
      <p className="mt-1 text-sm text-gray-600">
        Every organization on the platform — owner, subscription, trial status, and usage.
      </p>
      <EmptyState
        title="Not built yet"
        description="Organization Explorer ships in a later PR (Sale-Ready Phase C, PR3)."
      />
    </div>
  );
}
