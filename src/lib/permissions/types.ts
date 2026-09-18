import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Roles / Permissions V1 — same shape as every other domain module's own
 * PrismaClientOrTx (src/lib/tags/types.ts, src/lib/industry-presets/
 * types.ts, etc.) — every function across this directory accepts either
 * the top-level singleton or an already-open transaction, following this
 * repo's own "each module keeps its own copy, never cross-imported"
 * convention.
 */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
