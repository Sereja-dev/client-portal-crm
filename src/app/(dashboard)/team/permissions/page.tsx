import { getCurrentMembership } from "@/lib/current-user";
import { assertCanManageRolePermissions, RolePermissionManagementAccessError } from "@/lib/permissions/authorization";
import { getEffectivePermissionSet } from "@/lib/permissions/resolver";
import { getGroupedPermissionCatalog } from "@/lib/permissions/catalog";
import { RolePermissionsAccessDenied } from "@/components/team/role-permissions-access-denied";
import { RolePermissionsManager } from "@/components/team/role-permissions-manager";
import { updateRolePermissionsAction } from "./actions";

/**
 * Roles / Permissions V1 — /team/permissions, OWNER-only for both read
 * and write in V1 (locked spec §10/§15). ADMIN/MEMBER get a dedicated
 * Access denied state, not a redirect or a read-only view, mirroring
 * PaymentDetailsPage's own identical "the most sensitive settings pages
 * in this app deny outright rather than showing a read-only preview"
 * precedent — appropriate here since permission administration is at
 * least as sensitive as Team's own role/membership administration, which
 * ADMIN already has zero access to.
 */
export default async function RolePermissionsPage() {
  const { organizationId, membership } = await getCurrentMembership();

  try {
    assertCanManageRolePermissions(membership.role);
  } catch (err) {
    if (err instanceof RolePermissionManagementAccessError) {
      return <RolePermissionsAccessDenied />;
    }
    throw err;
  }

  const [adminSet, memberSet] = await Promise.all([
    getEffectivePermissionSet({ organizationId, role: "ADMIN" }),
    getEffectivePermissionSet({ organizationId, role: "MEMBER" }),
  ]);

  const groups = getGroupedPermissionCatalog();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Roles &amp; permissions</h1>
      <p className="text-text-secondary mt-1 text-sm">
        The organization owner always has full access to every feature below and cannot be changed. Configure what
        Admin and Member can access — changes apply immediately to everyone currently holding that role.
      </p>

      <RolePermissionsManager
        action={updateRolePermissionsAction}
        groups={groups}
        initial={{ ADMIN: adminSet, MEMBER: memberSet }}
      />
    </div>
  );
}
