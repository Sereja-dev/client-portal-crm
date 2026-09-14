import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Contracts Phase 1 — schema/domain foundation only (see Contract's own
 * doc comment in prisma/schema.prisma, and the completed Contracts
 * readiness audit). No Staff UI, no Portal UI, no PDF, no email, no
 * Contract Templates yet — every function across this directory is a
 * plain async function, org-scoped, following
 * src/lib/quote-templates/types.ts's own established precedent exactly.
 */

/** Same shape as every other domain module's own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
