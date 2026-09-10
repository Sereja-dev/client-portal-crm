import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalOverview } from "@/lib/client-portal/queries";
import { MetricCard } from "@/components/dashboard/metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { PortalWelcomeBanner } from "@/components/portal/portal-welcome-banner";
import { isPortalWelcomeEligible } from "@/components/portal/portal-welcome-eligibility";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { formatCurrency } from "@/lib/format";

const OVERVIEW_HEADING_ID = "portal-overview-heading";

const itemLinkClass =
  "text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export default async function PortalOverviewPage() {
  const { client, clientId, organizationId, portalUser } = await getCurrentPortalUser();
  const overview = await getPortalOverview(clientId, organizationId);
  const welcomeEligible = isPortalWelcomeEligible(portalUser.createdAt, new Date());

  return (
    <div className="space-y-8">
      <div>
        {/* Stage 6 audit fix: focus-return target for PortalWelcomeBanner's
            "Got it" dismiss — see onboarding-step-row.tsx's own comment on
            why this uses plain `focus:` rather than `focus-visible:`
            (never in the tab order, only ever programmatically focused). */}
        <h1
          id={OVERVIEW_HEADING_ID}
          tabIndex={-1}
          className="text-text-primary focus:ring-focus-ring rounded text-2xl font-semibold tracking-tight break-words focus:outline-none focus:ring-2 focus:ring-offset-2"
        >
          {client.name}
        </h1>
        <p className="text-text-muted mt-1 text-sm">
          An overview of your projects and invoices.
        </p>
      </div>

      <PortalWelcomeBanner eligible={welcomeEligible} returnFocusId={OVERVIEW_HEADING_ID} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Active projects"
          value={overview.activeProjectsCount}
          href="/portal/projects"
        />
        <MetricCard
          label="Open invoices"
          value={overview.openInvoicesCount}
          href="/portal/invoices"
        />
        <MetricCard
          label="Outstanding amount"
          value={formatCurrency(overview.outstandingAmount)}
          href="/portal/invoices?status=open"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-text-primary text-sm font-semibold">Recent projects</h2>
            <Link href="/portal/projects" className={ACTION_LINK_CLASSES}>
              View all
            </Link>
          </div>
          {overview.recentProjects.length === 0 ? (
            <p className="text-text-muted text-sm">No projects yet.</p>
          ) : (
            <ul className="space-y-3">
              {overview.recentProjects.map((project) => {
                const presentation = resolveStatusPresentation(project.statusDefinition, project.status);
                return (
                <li key={project.id} className="flex items-center justify-between gap-3">
                  <Link href={`/portal/projects/${project.id}`} className={itemLinkClass}>
                    {project.name}
                  </Link>
                  <StatusBadge status={project.status} label={presentation.label} tone={presentation.tone} />
                </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-text-primary text-sm font-semibold">Recent invoices</h2>
            <Link href="/portal/invoices" className={ACTION_LINK_CLASSES}>
              View all
            </Link>
          </div>
          {overview.recentInvoices.length === 0 ? (
            <p className="text-text-muted text-sm">No invoices yet.</p>
          ) : (
            <ul className="space-y-3">
              {overview.recentInvoices.map((invoice) => (
                <li key={invoice.id} className="flex items-center justify-between gap-3">
                  <Link href={`/portal/invoices/${invoice.id}`} className={itemLinkClass}>
                    {invoice.invoiceNumber}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="text-text-muted text-sm">
                      {formatCurrency(invoice.amount, invoice.currency)}
                    </span>
                    <StatusBadge status={invoice.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
