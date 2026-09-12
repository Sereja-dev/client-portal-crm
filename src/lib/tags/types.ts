import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Tags V1 Phase 1 — schema/domain foundation only (see Tag/TagAssignment's
 * own doc comments in prisma/schema.prisma, and prisma/migrations/
 * 20261001140000_add_tags_foundation's own header comment). No Staff UI,
 * no Portal exposure yet — every function across this directory is a
 * plain async function, org-scoped, following src/lib/custom-fields/
 * types.ts's own established "most recent, most architecturally similar
 * Phase 1 foundation" precedent exactly.
 */

/** Same shape as every other domain module's own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
