import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Custom Statuses Phase 1 — schema/domain foundation only (see
 * CustomStatusDefinition's own doc comment in prisma/schema.prisma for
 * the full design story, and this feature's own migration's header
 * comment). No UI, no Server Actions, no replacement of the existing
 * ClientStatus/LeadStage/ProjectStatus enum-driven screens yet — every
 * function across this directory is a plain async function, org-scoped,
 * following src/lib/custom-fields/'s own established conventions exactly
 * (the most recent, most architecturally similar "Phase 1 foundation" in
 * this repo).
 */

/** Same shape as Custom Fields' own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
