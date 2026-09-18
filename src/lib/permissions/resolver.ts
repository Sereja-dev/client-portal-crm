import "server-only";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { PERMISSION_KEYS, getDefaultPermission, isPermissionKey, type PermissionKey } from "./catalog";
import type { PrismaClientOrTx } from "./types";

/**
 * Roles / Permissions V1 — the central resolver (architecture lock
 * validation, locked spec §8). This is the ONLY place RolePermissionOverride
 * is ever queried — every domain authorization module (analytics,
 * reports, export, import, recurring-invoices, tags, workflow-
 * automations, quote-templates, industry-presets) delegates here rather
 * than embedding its own findUnique/findMany against this table (locked
 * spec §9/§21).
 *
 * `organizationId` and `role` must always come from the caller's own
 * trusted, server-resolved current-membership context (getCurrentMembership()
 * or an already-authorized actor object built from it) — this module
 * never resolves either itself, so tenant isolation is exactly as obvious
 * here as it is everywhere else in this codebase: the caller supplies the
 * boundary, this module only ever reads within it.
 *
 * Role stays DB-fresh (getCurrentMembership() is never cached across
 * requests) and nothing here is ever written to a JWT/Supabase claim or a
 * cross-request cache — a permission change takes effect on the very next
 * call, with no sign-out/sign-in required, the same guarantee this app's
 * Role checks have always had.
 */

export type EffectivePermissionSet = Readonly<Record<PermissionKey, boolean>>;

function buildDefaultSet(role: Role): Record<PermissionKey, boolean> {
  const set = {} as Record<PermissionKey, boolean>;
  for (const key of PERMISSION_KEYS) {
    set[key] = getDefaultPermission(role, key);
  }
  return set;
}

/**
 * One bounded query (a `findMany` scoped to organizationId+role, at most
 * PERMISSION_KEYS.length rows) merged onto the catalog defaults — never
 * one query per permission key. OWNER short-circuits to "every key true"
 * BEFORE any query at all: OWNER's access is unconditional and never
 * override-able (locked spec §2/§17), so a RolePermissionOverride row
 * targeting OWNER — which the table's own CHECK constraint and this
 * app's own write path both already forbid — would be inert here even if
 * one somehow existed.
 *
 * A row whose `permissionKey` isn't a current catalog key (e.g. a
 * retired permission's leftover row) is silently skipped, never applied
 * — the catalog is the sole source of truth for which keys are
 * meaningful (locked spec §2's "unknown permission keys must fail
 * closed").
 */
export async function getEffectivePermissionSet(
  { organizationId, role }: { organizationId: string; role: Role },
  client: PrismaClientOrTx = prisma,
): Promise<EffectivePermissionSet> {
  const defaults = buildDefaultSet(role);

  if (role === "OWNER") {
    return defaults;
  }

  const overrides = await client.rolePermissionOverride.findMany({
    where: { organizationId, role },
    select: { permissionKey: true, allowed: true },
  });

  const resolved: Record<PermissionKey, boolean> = { ...defaults };
  for (const row of overrides) {
    if (isPermissionKey(row.permissionKey)) {
      resolved[row.permissionKey] = row.allowed;
    }
  }
  return resolved;
}

/**
 * Single-key convenience — deliberately implemented on top of
 * getEffectivePermissionSet() rather than its own findUnique, so there is
 * exactly one query SHAPE this whole feature ever issues against
 * RolePermissionOverride (a findMany scoped to organizationId+role), not
 * two independently-maintained read paths that could drift apart. Still a
 * single bounded query either way (at most 9 rows).
 *
 * An unrecognized permissionKey fails closed (`false`) without ever
 * reaching the database — mirrors isPermissionKey()'s own "never a
 * prefix/substring match" discipline.
 */
export async function getEffectivePermission(
  { organizationId, role, permissionKey }: { organizationId: string; role: Role; permissionKey: PermissionKey },
  client: PrismaClientOrTx = prisma,
): Promise<boolean> {
  if (!isPermissionKey(permissionKey)) {
    return false;
  }
  const set = await getEffectivePermissionSet({ organizationId, role }, client);
  return set[permissionKey];
}

/**
 * Request-scoped memoization ONLY — React's cache() dedupes calls with
 * the same arguments within one render pass (Server Component tree) or
 * one Server Action invocation; it never persists across separate
 * requests/actions (already this codebase's own established pattern —
 * see src/lib/supabase/server.ts and src/lib/platform-admin/
 * authorization.ts's own identical use of `cache` from "react"). Exists
 * so a layout that resolves the effective set once can hand it down to
 * multiple sibling components (Sidebar, SettingsNav) without each of them
 * re-querying the same (organizationId, role) pair — never a substitute
 * for the plain getEffectivePermissionSet() above, which every non-render-
 * tree caller (domain authorization helpers, Server Actions) should keep
 * calling directly rather than relying on a cache whose scope is less
 * obviously "exactly one request" in that context.
 */
export const getCachedEffectivePermissionSet = cache(
  async (organizationId: string, role: Role): Promise<EffectivePermissionSet> =>
    getEffectivePermissionSet({ organizationId, role }),
);
