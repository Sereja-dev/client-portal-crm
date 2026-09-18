import { getCurrentMembership } from "@/lib/current-user";
import { assertCanManageIntegrations, IntegrationsAccessError } from "@/lib/integrations/authorization";
import { getIntegrationConnectionSummary } from "@/lib/integrations/connection";
import { IntegrationsAccessDenied } from "@/components/integrations/integrations-access-denied";
import { SlackConnectionCard } from "./slack-connection-card";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §31). OWNER-only for both read and write —
 * mirrors src/app/(dashboard)/settings/payment/page.tsx's own exact
 * pattern (assertCanManageIntegrations throws, caught here, rendered as
 * a dedicated Access denied state): the connection summary is never even
 * fetched for a non-OWNER identity, so there's no data to leak even in a
 * redacted form. Staff-only by construction: this route lives under
 * (dashboard), whose layout already redirects any Client Portal-only
 * identity to /portal before this page ever renders.
 *
 * One real provider card only (Slack) — no fake/greyed-out "coming soon"
 * provider grid (locked spec §31: "No fake Google/Microsoft cards").
 */
export default async function IntegrationsPage() {
  const { organizationId, membership } = await getCurrentMembership();

  try {
    assertCanManageIntegrations(membership.role);
  } catch (err) {
    if (err instanceof IntegrationsAccessError) {
      return <IntegrationsAccessDenied />;
    }
    throw err;
  }

  const connection = await getIntegrationConnectionSummary(organizationId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Integrations</h1>
      <p className="text-text-muted mt-1 text-sm">
        Connect Aqenra to other tools. Visible only to you, the organization owner.
      </p>
      <div className="mt-6">
        <SlackConnectionCard connection={connection} />
      </div>
    </div>
  );
}
