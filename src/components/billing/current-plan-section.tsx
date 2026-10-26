import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { BillingPageViewModel } from "@/lib/billing/view-model";
import { NoticeBanner } from "./notice-banner";
import { ManageSubscriptionButton } from "./manage-subscription-button";

export function CurrentPlanSection({ data }: { data: BillingPageViewModel }) {
  return (
    <section aria-labelledby="billing-current-plan-heading" className={`p-5 ${CARD_SURFACE_CLASSES}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="billing-current-plan-heading" className="text-text-primary text-base font-semibold">
            {data.currentPlanName}
          </h2>
          <div className="mt-1.5">
            <StatusBadge status={data.statusLabel} />
          </div>
        </div>

        {!data.permissions.canManageSubscription ? (
          <div className="text-right">
            <Button type="button" variant="secondary" disabled aria-disabled="true">
              Manage subscription
            </Button>
            <p className="text-text-muted mt-1 text-xs">Only the organization owner can manage billing.</p>
          </div>
        ) : data.freeBetaMode ? (
          // Free Public Beta, Slice 1 — checked ahead of
          // providerAvailability.configured, deliberately: must stay this
          // way even if Paddle is configured later for internal sandbox
          // testing while the beta is still running. manageSubscriptionAction
          // independently fails closed for the same case (see that
          // action's own freeBetaMode check) — this disabled button is UI
          // hiding, not the only defense.
          <div className="text-right">
            <Button type="button" variant="secondary" disabled aria-disabled="true">
              Manage subscription
            </Button>
            <p className="text-text-muted mt-1 text-xs">Paid plans aren&apos;t available during the free beta.</p>
          </div>
        ) : !data.providerAvailability.configured ? (
          // Billing provider-unavailable UI remediation: manageSubscriptionAction
          // already fails closed here ("Billing provider is not configured.",
          // src/app/(dashboard)/settings/billing/actions.ts) — the real button
          // must not stay clickable only to dead-end there. The string below is
          // reused verbatim from that action's own copy, kept as a plain literal
          // rather than imported from it: that module is "use server", and every
          // one of its exports must be an async Server Action, so it has no
          // constant this client component could import without an
          // architecturally inappropriate server/client boundary violation.
          <div className="text-right">
            <Button type="button" variant="secondary" disabled aria-disabled="true">
              Manage subscription
            </Button>
            <p className="text-text-muted mt-1 text-xs">Billing provider is not configured.</p>
          </div>
        ) : (
          <ManageSubscriptionButton />
        )}
      </div>

      <div className="mt-4">
        <NoticeBanner notice={data.statusNotice} />
      </div>

      <dl className="text-text-secondary mt-4 space-y-1 text-sm">
        {/*
          Free Public Beta, Slice 1: this row is the one other place
          (besides statusNotice above) that would otherwise surface a
          trial countdown — gated on !data.freeBetaMode for the same
          reason buildStatusNotice itself branches on it first.
        */}
        {!data.freeBetaMode && data.trialEndsAt && !data.trialExpired && (
          <div>
            <dt className="sr-only">Trial ends</dt>
            <dd>
              Trial ends on {data.trialEndsAt.toLocaleDateString()}
              {data.trialDaysRemaining !== null &&
                ` (${data.trialDaysRemaining} ${data.trialDaysRemaining === 1 ? "day" : "days"} remaining)`}
              .
            </dd>
          </div>
        )}

        {data.cancelAtPeriodEnd && data.currentPeriodEnd && (
          <div>
            <dt className="sr-only">Subscription ends</dt>
            <dd>Your subscription will end on {data.currentPeriodEnd.toLocaleDateString()}.</dd>
          </div>
        )}

        {!data.cancelAtPeriodEnd && data.currentPeriodEnd && data.statusLabel === "ACTIVE" && (
          <div>
            <dt className="sr-only">Renews</dt>
            <dd>Renews on {data.currentPeriodEnd.toLocaleDateString()}.</dd>
          </div>
        )}

        {data.gracePeriodEndsAt && (
          <div>
            <dt className="sr-only">Grace period ends</dt>
            <dd>Grace period ends on {data.gracePeriodEndsAt.toLocaleDateString()}.</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
