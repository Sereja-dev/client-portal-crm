import "server-only";
import type { CustomFieldEntityType } from "@/generated/prisma/enums";
import type { PrismaClientOrTx } from "./types";
import { prisma } from "@/lib/prisma";

/**
 * Section F — stable machine identity, derived once from a label at
 * creation time and never auto-changed when the label is edited
 * afterward (see updateCustomFieldDefinition/renameCustomFieldOption's
 * own comments in definitions.ts/options.ts). Lower-case, machine-safe,
 * no arbitrary user-defined SQL-like names: only [a-z0-9_], collapsed and
 * trimmed, exactly the same "reject anything else at the validation
 * layer" discipline src/lib/validation/lead.ts's own parseLeadValue
 * already uses for its own field.
 */
const MAX_KEY_LENGTH = 64;

export function slugifyCustomFieldIdentifier(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/g, "");

  // A label with no machine-safe characters at all (e.g. all emoji/
  // punctuation) would otherwise derive an empty string, which can never
  // be a valid key — "field" is the same kind of honest, obviously-
  // generic fallback ClientContact's own backfill migration uses for its
  // "no email" case (see that migration's own header comment).
  return slug.length > 0 ? slug : "field";
}

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
