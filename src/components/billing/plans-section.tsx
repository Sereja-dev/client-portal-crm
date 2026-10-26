import type { BillingPageViewModel } from "@/lib/billing/view-model";
import { PlanCard } from "./plan-card";

/**
 * Unfinished Features Cleanup (Block 17) — this section used to render
 * unconditionally, with an operator-instruction subtitle ("Connect a
 * billing provider to publish pricing.") standing in for real pricing
 * whenever no provider was configured. Product decided that's exactly
 * the kind of unfinished-looking surface this block exists to eliminate
 * — a Staff user should never see plan cards with a dead-end Upgrade
 * button and internal setup instructions. The condition is placed here,
 * at this component's own top — the highest boundary that can decide
 * not to render the whole block at once — rather than scattered across
 * PlanCard/PlanActionButton, so the entire unfinished Plans block
 * disappears cleanly in one place. When a provider IS configured, this
 * renders exactly as before this slice: the real plan cards, with their
 * own real, working Upgrade/Downgrade action (see plan-action-button.tsx,
 * unchanged).
 *
 * Free Public Beta, Slice 1: `freeBetaMode` is checked the same way,
 * ahead of `providerAvailability.configured` — deliberately, so this
 * section stays hidden even if Paddle credentials are configured later
 * for internal sandbox testing while the beta is still running (the
 * explicit requirement this slice must satisfy). `requestPlanChangeAction`
 * independently fails closed for the same case — this is UI hiding, not
 * the only defense.
 */
export function PlansSection({ data }: { data: BillingPageViewModel }) {
  if (data.freeBetaMode || !data.providerAvailability.configured) {
    return null;
  }

  return (
    <section aria-labelledby="billing-plans-heading">
      <h2 id="billing-plans-heading" className="text-text-primary text-base font-semibold">
        Plans
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.availablePlans.map((plan) => (
          <PlanCard key={plan.planKey} plan={plan} permissions={data.permissions} />
        ))}
      </div>
    </section>
  );
}
