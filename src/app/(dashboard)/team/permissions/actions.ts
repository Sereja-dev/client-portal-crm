"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@/generated/prisma/enums";
import { getCurrentMembership } from "@/lib/current-user";
import { assertCanManageRolePermissions, RolePermissionManagementAccessError } from "@/lib/permissions/authorization";
import { updateRolePermissions } from "@/lib/permissions/management";

export type UpdateRolePermissionsState = { error: string | null };

/**
 * Roles / Permissions V1 — the one authoritative Server Action for
 * /team/permissions (locked spec §13). `role`/`submittedPermissionState`
 * are passed explicitly per call, never bound — same convention
 * changeRoleAction's own `action` prop shape already establishes
 * (src/components/team/role-select.tsx). organizationId/actor are always
 * server-resolved via getCurrentMembership() here, never trusted from
 * the caller.
 */
export async function updateRolePermissionsAction(
  role: Role,
  submittedPermissionState: unknown,
): Promise<UpdateRolePermissionsState> {
  const { user, organizationId, membership } = await getCurrentMembership();

  try {
    assertCanManageRolePermissions(membership.role);
  } catch (err) {
    if (err instanceof RolePermissionManagementAccessError) {
      return { error: err.message };
    }
    throw err;
  }

  const result = await updateRolePermissions(organizationId, role, submittedPermissionState, {
    id: user.id,
    name: user.name,
  });

  if (!result.ok) {
    return {
      error:
        result.reason === "INVALID_ROLE"
          ? "Permissions can only be configured for Admin or Member."
          : "Could not save permissions. Please reload and try again.",
    };
  }

  revalidatePath("/team/permissions");
  revalidatePath("/team");

  return { error: null };
}
