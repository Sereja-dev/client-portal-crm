import type { PrismaClientOrTx } from "./types";
import { prisma } from "@/lib/prisma";
import { SYSTEM_STATUS_DEFINITIONS } from "./constants";
import type { CustomStatusEntityType } from "@/generated/prisma/enums";

const ENTITY_TYPES: readonly CustomStatusEntityType[] = ["CLIENT", "LEAD", "PROJECT"];

/**
 * Deliberately does NOT `import "server-only"`, unlike every other module
 * in this feature — src/lib/current-user.ts's own getOrCreateOrganizationId
 * imports this module directly (Section N), and several existing unit
 * tests (test/unit/onboarding-progress.test.ts and friends,
 * test/unit/current-user-p2003-classifier.test.ts) already transitively
 * import current-user.ts with no Prisma/Next runtime available to them —
 * exactly organization-access.ts's own already-established precedent
 * (see that file's own doc comment) for "a module current-user.ts
 * imports must not force every existing caller's unit tests to also mock
 * 'server-only'." This module DOES touch the database (unlike
 * organization-access.ts's own pure predicate), but so does
 * billing/provisioning.ts's createTrialSubscription — the other function
 * this exact same transaction already calls — which carries the identical
 * exclusion for the identical reason.
 *
 * Custom Statuses Phase 1 (Section N) — the complete set of built-in
 * system status definitions for CLIENT/LEAD/PROJECT, for exactly one
 * organization. This is the application-code twin of this feature's own
 * migration's backfill INSERT statements (see that migration's own
 * header comment) — SYSTEM_STATUS_DEFINITIONS (constants.ts) is the one
 * shared source of truth both are derived from, so a new organization
 * created after this migration ships gets byte-identical definitions to
 * one backfilled by the migration itself.
 *
 * Called from inside the caller's own already-open transaction
 * (Section N: "Implement in the same transaction where possible") — see
 * src/lib/current-user.ts's getOrCreateOrganizationId for the real call
 * site, and test/fixtures/seed.ts for the test-fixture call site. Must
 * be called with `organizationId` freshly created in the SAME
 * transaction (or otherwise already known to exist) — this function
 * itself does no existence check, matching createTrialSubscription's own
 * "the transaction that created the Organization already guarantees
 * it exists" precedent in the same file.
 *
 * Idempotency: relies on CustomStatusDefinition's own
 * (organizationId, entityType, key) unique constraint — calling this
 * twice for the same organization throws a P2002 rather than silently
 * creating duplicates, since bootstrap is meant to run exactly once per
 * organization's lifetime (at creation). No caller in this phase ever
 * calls it a second time for the same organization.
 */
export async function bootstrapOrganizationStatusDefinitions(
  tx: PrismaClientOrTx,
  organizationId: string,
): Promise<void> {
  const rows = ENTITY_TYPES.flatMap((entityType) =>
    SYSTEM_STATUS_DEFINITIONS[entityType].map((seed) => ({
      organizationId,
      entityType,
      key: seed.key,
      label: seed.label,
      color: seed.color,
      position: seed.position,
      isDefault: seed.isDefault,
      isSystem: true,
    })),
  );

  await tx.customStatusDefinition.createMany({ data: rows });
}

/**
 * True if this organization already has its system status definitions
 * bootstrapped (any one entityType's default is enough to confirm all
 * three were created together, since bootstrapOrganizationStatusDefinitions
 * always writes all 15 rows in one createMany call). Used only by
 * callers that might run against a pre-existing organization (e.g. a
 * test fixture reused across files) and want to bootstrap exactly once,
 * never by the real organization-creation path, which always calls a
 * genuinely brand-new organizationId (see this file's own idempotency
 * comment above for why a real double-call is a bug, not a case to
 * silently tolerate there).
 */
export async function organizationHasStatusDefinitions(
  organizationId: string,
  client: PrismaClientOrTx = prisma,
): Promise<boolean> {
  const existing = await client.customStatusDefinition.findFirst({
    where: { organizationId },
    select: { id: true },
  });
  return existing !== null;
}
