import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { createActivity } from "@/lib/activity/create-activity";
import { buildRolePermissionMetadata, type RolePermissionChangeEntry } from "@/lib/activity/role-permission-metadata";
import { PERMISSION_KEYS, getDefaultPermission, getPermissionCatalogEntry, isPermissionKey, type PermissionKey } from "./catalog";
import { getEffectivePermissionSet } from "./resolver";

/**
 * Roles / Permissions V1 — the one authoritative write path for
 * RolePermissionOverride (locked spec §13/§14/§21). The "use server"
 * Action wrapper (src/app/(dashboard)/team/permissions/actions.ts) is
 * responsible for verifying the CALLER is OWNER before ever reaching
 * this function — the same split every other Team mutation already has
 * between its "use server" file and its domain layer. This function
 * still independently validates every other input, never trusting the
 * wrapper to have already done so.
 */

export type PermissionUpdateActor = { id: string; name: string };

export type RolePermissionUpdateResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "INVALID_ROLE" | "INVALID_INPUT" };

/**
 * Validates that `submitted` is a plain object with EXACTLY the 9
 * catalog keys, each a real boolean — no unknown keys, no missing keys,
 * no duplicates (impossible for a plain object's own keys, kept as an
 * explicit check anyway so this reads as a real requirement rather than
 * an accident of JS object semantics), no malformed values silently
 * coerced (locked spec §13: "do not silently ignore extra keys").
 */
function parseSubmittedPermissionState(submitted: unknown): Record<PermissionKey, boolean> | null {
  if (typeof submitted !== "object" || submitted === null || Array.isArray(submitted)) {
    return null;
  }
  const entries = Object.entries(submitted as Record<string, unknown>);
  if (entries.length !== PERMISSION_KEYS.length) {
    return null;
  }

  const seen = new Set<string>();
  for (const [key, value] of entries) {
    if (!isPermissionKey(key) || seen.has(key) || typeof value !== "boolean") {
      return null;
    }
    seen.add(key);
  }
  for (const key of PERMISSION_KEYS) {
    if (!seen.has(key)) {
      return null;
    }
  }

  return submitted as Record<PermissionKey, boolean>;
}

/**
 * pg_advisory_xact_lock, keyed by (organizationId, targetRole), is the
 * actual concurrency gate here — NOT an assumption that
 * deleteMany+createMany alone compose safely under concurrent saves.
 * They do not: two concurrent saves to the SAME role, each starting from
 * an empty/matching override set, can each issue a deleteMany that
 * matches zero rows (never blocking on anything, since there is nothing
 * to lock yet) and then each createMany their own, DIFFERENT deviating
 * keys — under ordinary Postgres READ COMMITTED, both inserts can
 * commit, producing a MERGED override set neither save's own submitted
 * form state ever represented, not the deterministic whole-role-replace
 * last-writer-wins the locked spec requires (§14: "a save replaces the
 * ENTIRE sparse override set for that role atomically... not a per-key
 * merge"). Transaction-scoped (`_xact_`) — released automatically on
 * commit OR rollback, so a thrown/rolled-back save can never leak the
 * lock and there is no manual unlock to forget. Acquired as the FIRST
 * statement, before the previousSet read, mirroring
 * leaveOrganizationAction's own "the gate is the first statement, not an
 * afterthought" precedent (src/app/(dashboard)/team/actions.ts). With
 * this lock held, a second concurrent save to the same role blocks until
 * the first fully commits, then its own previousSet read (taken AFTER
 * acquiring the lock) correctly observes the first save's already-
 * committed result — so both the final DB state and that second save's
 * own Activity diff stay accurate and mutually consistent, genuine
 * last-writer-wins with no merge and no stale audit entry. Different
 * roles hash to different lock keys, so ADMIN and MEMBER saves for the
 * same organization never contend with each other.
 */
async function acquireRolePermissionLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  role: Role,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId} || ':' || ${role}, 0))`;
}

export async function updateRolePermissions(
  organizationId: string,
  targetRole: Role,
  submitted: unknown,
  actor: PermissionUpdateActor,
): Promise<RolePermissionUpdateResult> {
  if (targetRole !== "ADMIN" && targetRole !== "MEMBER") {
    return { ok: false, reason: "INVALID_ROLE" };
  }

  const nextState = parseSubmittedPermissionState(submitted);
  if (!nextState) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const changed = await prisma.$transaction(async (tx) => {
    await acquireRolePermissionLock(tx, organizationId, targetRole);

    const previousSet = await getEffectivePermissionSet({ organizationId, role: targetRole }, tx);

    const changes: RolePermissionChangeEntry[] = [];
    for (const key of PERMISSION_KEYS) {
      if (previousSet[key] !== nextState[key]) {
        changes.push({
          permissionKey: key,
          permissionLabel: getPermissionCatalogEntry(key).label,
          previousEffectiveValue: previousSet[key],
          newEffectiveValue: nextState[key],
        });
      }
    }

    // No-op save -- no write, no Activity (locked spec §13: never a
    // misleading audit entry for a save that changed nothing).
    if (changes.length === 0) {
      return false;
    }

    // Whole-role replace: delete every existing override row for this
    // (organizationId, targetRole), then recreate only the keys whose
    // submitted value deviates from the catalog default -- bounded at
    // exactly 2 writes regardless of how many of the 9 keys deviate,
    // never a per-key upsert loop (locked spec §13/§31). Sparse-override
    // invariant: a key whose submitted value equals the default is never
    // persisted as a row at all.
    await tx.rolePermissionOverride.deleteMany({ where: { organizationId, role: targetRole } });

    const deviations = PERMISSION_KEYS.filter((key) => nextState[key] !== getDefaultPermission(targetRole, key));
    if (deviations.length > 0) {
      await tx.rolePermissionOverride.createMany({
        data: deviations.map((key) => ({
          organizationId,
          role: targetRole,
          permissionKey: key,
          allowed: nextState[key],
        })),
      });
    }

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "ROLE_PERMISSION",
      entityId: organizationId,
      action: "UPDATED",
      metadata: buildRolePermissionMetadata(targetRole, actor.name, changes),
    });

    return true;
  });

  return { ok: true, changed };
}
