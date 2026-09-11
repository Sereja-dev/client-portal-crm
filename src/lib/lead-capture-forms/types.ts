import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Same shape as Custom Statuses'/Custom Fields' own PrismaClientOrTx — every function in this directory accepts either the top-level singleton or an already-open transaction. */
export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
