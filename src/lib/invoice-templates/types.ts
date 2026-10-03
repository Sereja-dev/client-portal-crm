import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Invoice Templates V1 — mirrors src/lib/quote-templates/types.ts's own
 * identical shape exactly.
 */

/** Same shape as every other domain module's own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
