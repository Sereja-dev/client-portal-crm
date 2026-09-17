import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Industry Presets V1 — schema/domain foundation. Same shape as every
 * other domain module's own PrismaClientOrTx (src/lib/tags/types.ts,
 * src/lib/custom-fields/types.ts, src/lib/custom-statuses/types.ts) —
 * every function across this directory accepts either the top-level
 * singleton or an already-open transaction, following this repo's own
 * "each module keeps its own copy, never cross-imported" convention.
 */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
