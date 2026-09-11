import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Workflow Automations Phase 1 — config/domain foundation only (see
 * WorkflowAutomation's own doc comment in prisma/schema.prisma). No
 * dispatch, no execution: createActivity() is not wired to any of this
 * yet (see src/lib/activity/create-activity.ts's own header comment,
 * untouched by this phase). Every function across this directory is a
 * plain async function, org-scoped, following src/lib/custom-fields/
 * types.ts's own "most recent, most architecturally similar Phase 1
 * foundation" precedent exactly.
 */

/** Same shape as every other domain module's own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
