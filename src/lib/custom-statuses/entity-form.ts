import type { CustomStatusEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { listCustomStatusDefinitions } from "./definitions";
import type { PrismaClientOrTx } from "./types";
import type { StatusSelectOption } from "./select-options";

/**
 * Custom Statuses Phase 2B (Section L/M/O/R) — shared helpers every
 * Client/Lead/Project create+edit Server Action and form uses to
 * present and resolve a status-definition selector. Deliberately NOT
 * `import "server-only"` — mirrors resolution.ts's own identical
 * reasoning (a pure/read-mostly module reachable from a broader context
 * than just Server Actions is safer without the marker); this module is
 * imported by page.tsx Server Components only in practice, but keeping
 * it marker-free avoids the exact class of transitive-import breakage
 * Phase 2A's own bootstrap.ts/resolution.ts fixes already documented.
 *
 * `StatusSelectOption` (the type) and `mergeCurrentStatusOption` (the one
 * pure, DB-free helper here) now live in ./select-options.ts instead —
 * see that file's own comment for why: a "use client" component
 * importing a RUNTIME binding from THIS module would also pull this
 * module's own `import { prisma }` into the browser bundle. Re-exported
 * as a type here so every existing `import type { StatusSelectOption }
 * from ".../entity-form"` call site keeps working unchanged (a type-only
 * import is always erased, so it can never leak Prisma either way).
 */
export type { StatusSelectOption } from "./select-options";

/**
 * The option list for an entity's status `<select>` (Section L/M/O):
 * every active definition for this organization+entityType, in
 * position order (system and custom share one ordering). When
 * `currentDefinitionId` names a definition that is NOT in that active
 * list (because it's archived), that one definition is appended at the
 * end, marked `archived: true` — "shown as current selected option with
 * '(archived)', allow user to keep it, do not offer archived statuses
 * for new selection" is satisfied structurally: it is the only archived
 * entry ever present, and only because it's already assigned.
 */
export async function buildStatusSelectOptions(
  organizationId: string,
  entityType: CustomStatusEntityType,
  currentDefinitionId: string | null,
  client: PrismaClientOrTx = prisma,
): Promise<StatusSelectOption[]> {
  const active = await listCustomStatusDefinitions(organizationId, entityType, {}, client);
  const options: StatusSelectOption[] = active.map((d) => ({
    id: d.id,
    key: d.key,
    label: d.label,
    color: d.color,
    isSystem: d.isSystem,
    isDefault: d.isDefault,
    archived: false,
  }));

  if (currentDefinitionId && !options.some((o) => o.id === currentDefinitionId)) {
    const current = await client.customStatusDefinition.findFirst({
      where: { id: currentDefinitionId, organizationId, entityType },
    });
    if (current) {
      options.push({
        id: current.id,
        key: current.key,
        label: current.label,
        color: current.color,
        isSystem: current.isSystem,
        isDefault: current.isDefault,
        archived: true,
      });
    }
  }

  return options;
}

export type ResolveStatusForSaveResult =
  | { ok: true; definitionId: string; isSystem: boolean; key: string }
  | { ok: false; reason: "NOT_FOUND" | "ARCHIVED" };

/**
 * CREATE-or-EDIT save-time resolution (Section R): re-fetches the
 * requested definition by {id, organizationId, entityType} — never
 * trusts that a client-supplied id was really offered by an in-org-only
 * `<select>` — and rejects an archived target UNLESS it exactly matches
 * the entity's own existing current definition (`currentDefinitionId`,
 * null for a brand-new entity — CREATE can therefore never keep an
 * archived target, only EDIT's own "keep unchanged" case can). A
 * foreign-org id, a wrong-entityType id, and a nonexistent id are all
 * indistinguishable NOT_FOUND results (Section S).
 */
export async function resolveStatusForSave(
  organizationId: string,
  entityType: CustomStatusEntityType,
  requestedDefinitionId: string,
  currentDefinitionId: string | null,
  client: PrismaClientOrTx = prisma,
): Promise<ResolveStatusForSaveResult> {
  const definition = await client.customStatusDefinition.findFirst({
    where: { id: requestedDefinitionId, organizationId, entityType },
  });
  if (!definition) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (definition.archivedAt !== null && requestedDefinitionId !== currentDefinitionId) {
    return { ok: false, reason: "ARCHIVED" };
  }
  return { ok: true, definitionId: definition.id, isSystem: definition.isSystem, key: definition.key };
}
