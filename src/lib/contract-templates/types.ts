import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;
