import type { Role } from "@/generated/prisma/enums";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §10). Deliberately hard-coded OWNER-only, never
 * one of the Roles / Permissions V1 configurable catalog's 9 keys (see
 * src/lib/permissions/catalog.ts) -- a stored, decryptable outbound
 * credential is "too sensitive to delegate," the exact same tier Payment
 * Details already sits at (src/lib/organization-setup/authorization.ts's
 * own canAccessPaymentDetails), and the locked spec is explicit that no
 * INTEGRATIONS_MANAGE permission key exists. Its own, separate, named
 * predicate -- never reused from an unrelated domain's own helper --
 * matches this codebase's established "each domain gets its own named
 * predicate" convention (see src/lib/permissions/authorization.ts's own
 * doc comment for the identical reasoning applied to Roles/Permissions
 * management itself).
 */
export class IntegrationsAccessError extends Error {
  constructor() {
    super("Integrations are only available to the organization owner.");
    this.name = "IntegrationsAccessError";
  }
}

export function canManageIntegrations(role: Role): boolean {
  return role === "OWNER";
}

/** Throws `IntegrationsAccessError` for ADMIN/MEMBER — the /settings/integrations page and every Server Action (connect/replace/disconnect/send test) call this first, before any read/write. */
export function assertCanManageIntegrations(role: Role): void {
  if (!canManageIntegrations(role)) {
    throw new IntegrationsAccessError();
  }
}
