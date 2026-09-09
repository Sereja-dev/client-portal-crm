import "server-only";
import type { CustomFieldEntityType } from "@/generated/prisma/enums";
import type { PrismaClientOrTx } from "./types";
import { prisma } from "@/lib/prisma";
import { slugifyCustomFieldIdentifier } from "./slug";

// The pure slugifier lives in its own non-server-only module so Custom
// Fields Phase 2A's Create dialog can import it client-side for a
// cosmetic "Internal key" preview — see slug.ts's own doc comment.
// Re-exported here so every existing import of
// `slugifyCustomFieldIdentifier` from this file (this module's own
// callers below, plus test/integration/custom-fields/definitions.test.ts)
// keeps working unchanged.
export { slugifyCustomFieldIdentifier } from "./slug";

/**
 * Deterministic collision handling (Section F): base slug, then
 * `${base}_2`, `${base}_3`, ... until one is free within this
 * organization+entityType. Archived definitions still occupy their key
 * (Section F/H — see CustomFieldDefinition's own schema comment), so this
 * check deliberately does NOT filter by archivedAt.
 */
export async function deriveUniqueCustomFieldDefinitionKey(
  organizationId: string,
  entityType: CustomFieldEntityType,
  label: string,
  client: PrismaClientOrTx = prisma,
): Promise<string> {
  const base = slugifyCustomFieldIdentifier(label);

  let candidate = base;
  let suffix = 2;
  // Bounded by the actual number of existing colliding keys, so this
  // loop terminates the moment a free slug is found — never unbounded.
  while (
    await client.customFieldDefinition.findFirst({
      where: { organizationId, entityType, key: candidate },
      select: { id: true },
    })
  ) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/**
 * Same deterministic collision handling as above, scoped to one
 * definitionId's own option list instead of an organization+entityType
 * pair (CustomFieldOption has no direct organizationId — see that
 * model's own schema comment).
 */
export async function deriveUniqueCustomFieldOptionValue(
  definitionId: string,
  label: string,
  client: PrismaClientOrTx = prisma,
): Promise<string> {
  const base = slugifyCustomFieldIdentifier(label);

  let candidate = base;
  let suffix = 2;
  while (
    await client.customFieldOption.findFirst({
      where: { definitionId, value: candidate },
      select: { id: true },
    })
  ) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }

  return candidate;
}
