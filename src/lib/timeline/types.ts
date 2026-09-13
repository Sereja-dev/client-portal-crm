import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Communication Timeline Phase 1 — schema/domain foundation only (see
 * TimelineNote's own doc comment in prisma/schema.prisma, and
 * prisma/migrations/20261001150000_add_timeline_notes_foundation's own
 * header comment). No Staff UI yet — every function across this
 * directory is a plain async function, org-scoped, following
 * src/lib/tags/types.ts's own established "most recent, most
 * architecturally similar Phase 1 foundation" precedent exactly.
 */

/** Same shape as every other domain module's own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
