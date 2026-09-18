import { getCurrentMembership } from "@/lib/current-user";
import { canAccessPaymentDetails } from "@/lib/organization-setup/authorization";
import { getCachedEffectivePermissionSet } from "@/lib/permissions/resolver";
import { canManageIntegrations } from "@/lib/integrations/authorization";
import { SettingsNav } from "@/components/settings/settings-nav";

/**
 * Pre-Launch Audit F1 fix. Before this layout, /settings/company,
 * /settings/payment, and /settings/domain were only ever reachable via the
 * onboarding card (dismissible/completable) or the invoice-issuance
 * readiness notice (renders nothing once both are configured) — no
 * persistent UI path existed back to them. This shared layout adds one,
 * consistent nav across every /settings/* page, mirroring how
 * app/portal/(app)/layout.tsx already renders <PortalNav /> once for its
 * whole route group rather than duplicating it per page.
 *
 * getCurrentMembership() here is the exact same call every settings page
 * already makes independently for its own authorization — calling it a
 * second time (layout + page) is the same redundant-per-request-resolution
 * shape (dashboard)/layout.tsx and every page below it already has, not a
 * new pattern. canAccessPaymentDetails() is the single canonical helper
 * (organization-setup/authorization.ts) — never re-derived here, and this
 * only controls whether the *link* renders. It is not the security
 * boundary: /settings/payment's own page-level
 * assertCanAccessPaymentDetails() check is completely unchanged and still
 * independently enforces the real access boundary for a direct URL visit.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { organizationId, membership } = await getCurrentMembership();
  const canAccessPayment = canAccessPaymentDetails(membership.role);
  // Roles / Permissions V1 — Workflow Automations/Tags/Quote Templates
  // nav visibility is now the effective WORKFLOW_AUTOMATIONS_MANAGE/
  // TAGS_MANAGE/QUOTE_TEMPLATES_MANAGE permission (locked spec §12),
  // configurable by the OWNER at /team/permissions, rather than a fixed
  // inline OWNER/ADMIN check — one bounded, request-scoped resolution
  // (getCachedEffectivePermissionSet, React's own per-request cache())
  // for all three, never three separate queries. With zero overrides
  // this reproduces the exact pre-V1 OWNER/ADMIN-only nav visibility
  // (locked spec §6). Still discoverability only — every page under
  // each of these three routes independently re-verifies the same
  // effective permission server-side, unchanged.
  const effectivePermissions = await getCachedEffectivePermissionSet(organizationId, membership.role);
  const canManageWorkflowAutomations = effectivePermissions.WORKFLOW_AUTOMATIONS_MANAGE;
  const canManageTags = effectivePermissions.TAGS_MANAGE;
  const canManageQuoteTemplates = effectivePermissions.QUOTE_TEMPLATES_MANAGE;
  // Integrations V1 — deliberately NOT part of the Roles / Permissions
  // catalog above (locked spec §10/§23): a plain inline OWNER check, the
  // exact same mechanism canAccessPayment already uses two lines up,
  // never getCachedEffectivePermissionSet.
  const canManageIntegrationsValue = canManageIntegrations(membership.role);

  return (
    <div>
      <SettingsNav
        canAccessPayment={canAccessPayment}
        canManageWorkflowAutomations={canManageWorkflowAutomations}
        canManageTags={canManageTags}
        canManageQuoteTemplates={canManageQuoteTemplates}
        canManageIntegrations={canManageIntegrationsValue}
      />
      {children}
    </div>
  );
}
