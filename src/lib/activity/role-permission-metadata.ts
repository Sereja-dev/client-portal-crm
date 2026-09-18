// Safe metadata builder for ROLE_PERMISSION / UPDATED Activity events
// (Roles / Permissions V1, locked spec §15). Never includes: the raw
// override row id, the full submitted permission state, or anything
// about ANY specific Membership/user — a permission change is org+role
// scoped, never about one person (see prisma/schema.prisma's own
// ActivityEntityType.ROLE_PERMISSION doc comment on why this is never
// recorded as MEMBERSHIP). `permissionLabel` is snapshotted at write
// time (never re-derived from the catalog at render time) — the same
// "store the human name now, don't look it up again later" discipline
// team-metadata.ts's own memberName/email fields already establish.

export type RolePermissionChangeEntry = {
  permissionKey: string;
  permissionLabel: string;
  previousEffectiveValue: boolean;
  newEffectiveValue: boolean;
};

export type RolePermissionActivityMetadata = {
  targetRole: string;
  actorName: string;
  changes: RolePermissionChangeEntry[];
};

/** One combined event per successful save (locked spec §15) — never one Activity row per changed key. */
export function buildRolePermissionMetadata(
  targetRole: string,
  actorName: string,
  changes: readonly RolePermissionChangeEntry[],
): RolePermissionActivityMetadata {
  return { targetRole, actorName, changes: [...changes] };
}
