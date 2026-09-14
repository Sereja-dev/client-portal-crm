import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Quote Templates Phase 1 — schema/domain foundation only (see
 * QuoteTemplate/QuoteTemplateItem's own doc comments in
 * prisma/schema.prisma, and the completed Templates architecture audit).
 * No Settings UI, no apply-prefill route yet — every function across this
 * directory is a plain async function, org-scoped, following
 * src/lib/tags/types.ts's own established "most recent, most
 * architecturally similar Phase 1 foundation" precedent exactly.
 */

/** Same shape as every other domain module's own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
