import { formatFileSize } from "@/lib/format";
import type { PlanCardViewModel, BillingManagementPermissions } from "@/lib/billing/view-model";
import { PlanActionButton } from "./plan-action-button";

const NOT_OWNER_REASON = "Only the organization owner can manage billing.";

export function PlanCard({
  plan,
  permissions,
}: {
  plan: PlanCardViewModel;
  permissions: BillingManagementPermissions;
}) {
  const disabledReason = plan.isCurrentPlan
    ? undefined
    : !permissions.canManagePlan
      ? NOT_OWNER_REASON
      : undefined;

  return (
    // Not CARD_SURFACE_CLASSES here — the current-plan state needs its own
    // conditional border color (border-accent), and bundling
    // border-border-default from that constant alongside it would put two
    // same-specificity border-color utilities in one className, which
    // Tailwind's generated-CSS order (not source order) resolves
    // unpredictably (see button.tsx's own doc comment on this exact bug
    // class) — spelled out separately instead so exactly one border-color
    // utility is ever present per render.
    <div
      className={`flex flex-col rounded-lg border bg-surface p-5 ${
        plan.isCurrentPlan ? "border-accent" : "border-border-default"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-text-primary text-base font-semibold">{plan.displayName}</h3>
        {plan.isCurrentPlan && (
          <span className="bg-accent inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white">
            Current plan
          </span>
        )}
      </div>

      <p className="text-text-muted mt-1 text-sm">{plan.description}</p>

      <ul className="text-text-secondary mt-4 space-y-1 text-sm">
        <li>{plan.maxMembers} members</li>
        <li>{plan.maxClients === null ? "Unlimited clients" : `${plan.maxClients} clients`}</li>
        <li>{plan.maxProjects === null ? "Unlimited projects" : `${plan.maxProjects} projects`}</li>
        <li>{formatFileSize(plan.maxStorageBytes)} storage</li>
      </ul>

      {/*
        Unfinished Features Cleanup (Block 17) — this card previously
        showed a generic "Pricing configured by the product owner."
        line here instead of a real dollar amount (this stage's own §7
        rule: no fake pricing until a real provider is connected). This
        card is now only ever reached once PlansSection's own top-level
        gate (plans-section.tsx) has already confirmed a provider IS
        configured — so that line would be reachable on a genuinely
        working billing flow, which is exactly the internal-sounding
        copy Product decided must never reach ordinary Staff users,
        configured or not. No replacement price line is added — no real
        price exists in this view-model to show (PlanCardViewModel
        carries no price field at all), and inventing placeholder copy
        here would be the same class of problem this removal fixes.
      */}

      <div className="mt-4">
        <PlanActionButton
          planKey={plan.planKey}
          label={plan.ctaLabel}
          disabled={plan.ctaDisabled}
          disabledReason={disabledReason}
        />
      </div>
    </div>
  );
}
