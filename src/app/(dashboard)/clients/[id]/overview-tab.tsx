import type { ClientHealth } from "./profile-query";
import { ClientPortalAccessSection } from "./portal-access-section";
import type { Role } from "@/generated/prisma/enums";

/**
 * Client Profile Hub V1 — the working summary, not another Reports page.
 * Four health signals only (Section 7's own exact list), each using this
 * app's own existing canonical semantic — never a newly-invented one
 * (see profile-query.ts's own fetchClientHealth doc comment for exactly
 * which). Unpaid invoices is a currency-agnostic COUNT — never a summed
 * cross-currency amount. Portal Access is reused unchanged beneath the
 * health strip, per Section 7's own recommended placement.
 */

function HealthCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border-default bg-surface rounded-lg border p-4">
      <p className="text-text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="text-text-primary mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ClientOverviewTab({
  client,
  health,
  clientId,
  role,
}: {
  client: { notes: string | null; createdAt: Date };
  health: ClientHealth;
  clientId: string;
  role: Role;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <HealthCard label="Unpaid invoices" value={String(health.unpaidInvoiceCount)} />
        <HealthCard label="Open tasks" value={String(health.openTaskCount)} />
        <HealthCard label="Active projects" value={String(health.activeProjectCount)} />
        <HealthCard
          label="Last activity"
          value={health.lastActivityAt ? health.lastActivityAt.toLocaleDateString() : "No activity yet"}
        />
      </div>

      {client.notes && (
        <div className="border-border-default bg-surface mt-6 rounded-lg border p-4">
          <p className="text-text-muted text-xs font-medium tracking-wide uppercase">Notes</p>
          <p className="text-text-primary mt-1 text-sm whitespace-pre-wrap">{client.notes}</p>
        </div>
      )}
      <p className="text-text-muted mt-4 text-xs">Client since {client.createdAt.toLocaleDateString()}</p>

      <div id="portal-access">
        <ClientPortalAccessSection clientId={clientId} role={role} />
      </div>
    </div>
  );
}
