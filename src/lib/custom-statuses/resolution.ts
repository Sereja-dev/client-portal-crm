import type { CustomStatusDefinition } from "@/generated/prisma/client";
import type { CustomStatusEntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";

/**
 * Custom Statuses Phase 1 — resolution helpers (Section R/V). These are
 * pure reads, never mutations; every entity-assignment function in
 * assignment.ts is built on top of these.
 *
 * Custom Statuses Phase 2A: deliberately does NOT `import "server-only"`,
 * unlike definitions.ts/assignment.ts/bootstrap.ts — this module is now
 * imported by src/app/(dashboard)/dashboard/query.ts's own
 * getDashboardAnalytics() (Section K), which is in turn imported by
 * src/lib/ai/tools/organization-summary.ts, whose own unit tests (and
 * the whole AI tool registry's own test/unit/ai/registry.test.ts) run in
 * a plain Node environment with no Next.js Server Component boundary —
 * exactly src/lib/custom-statuses/bootstrap.ts's own established
 * precedent (see that file's own doc comment) for "a module reachable
 * from a legitimate broader context must not force every existing
 * caller's unit tests to also mock 'server-only'." This module has no
 * secret and does no mutation — a pure, safely-reusable read.
 */

/** The one active default definition for an organization+entityType (Section K). Never null in ordinary operation once an organization has been bootstrapped (bootstrap.ts always seeds exactly one default per entityType, and archiveCustomStatusDefinition refuses to archive the current default) — still typed nullable to fail closed rather than throw if that invariant is ever somehow violated. */
export async function getDefaultStatusDefinition(
  organizationId: string,
  entityType: CustomStatusEntityType,
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinition | null> {
  return client.customStatusDefinition.findFirst({
    where: { organizationId, entityType, isDefault: true, archivedAt: null },
  });
}

/**
 * Verifies a definitionId genuinely belongs to this organization AND
 * matches the expected entityType — never trusts a caller-provided
 * (organizationId, entityType, definitionId) relationship on its own
 * (Section V: "entityType validated"). A foreign-org or wrong-entityType
 * id returns false, indistinguishable from a nonexistent one.
 */
export async function assertStatusDefinitionOwnership(
  {
    organizationId,
    entityType,
    definitionId,
  }: {
    organizationId: string;
    entityType: CustomStatusEntityType;
    definitionId: string;
  },
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinition | null> {
  return client.customStatusDefinition.findFirst({
    where: { id: definitionId, organizationId, entityType },
  });
}

/**
 * Resolves exactly one SYSTEM definition by its own well-known, stable
 * key (Section G — see constants.ts's own SYSTEM_STATUS_KEYS for the
 * only four keys any real code should ever resolve this way: Lead WON/
 * LOST, Project IN_PROGRESS, Client ACTIVE). Deliberately requires
 * `isSystem: true` in the query itself — even if a Staff member somehow
 * created a CUSTOM definition whose key happens to collide with a
 * system key in a DIFFERENT entityType (impossible within the same
 * entityType, since key is unique per organization+entityType+key and
 * every system key is already permanently reserved from the moment
 * bootstrap.ts runs), this function could never resolve it as if it
 * were the system definition it is not.
 */
export async function resolveSystemStatusDefinition(
  organizationId: string,
  entityType: CustomStatusEntityType,
  systemKey: string,
  client: PrismaClientOrTx = prisma,
): Promise<CustomStatusDefinition | null> {
  return client.customStatusDefinition.findFirst({
    where: { organizationId, entityType, key: systemKey, isSystem: true },
  });
}
