import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Custom Fields Phase 1 — schema/domain foundation only (see
 * CustomFieldDefinition/CustomFieldOption/CustomFieldValue's own doc
 * comments in prisma/schema.prisma for the full design story, and
 * prisma/migrations/20260925090000_add_custom_fields_foundation's own
 * header comment). No Staff UI, no Portal exposure, no Quote/Invoice
 * integration yet — every function across this directory is a plain
 * async function, org-scoped, following src/lib/clients/contacts.ts's
 * own established conventions exactly (the most recent, most
 * architecturally similar "Phase 1 foundation" precedent in this repo).
 */

/** Same shape as ClientContact's own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
