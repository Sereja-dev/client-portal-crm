import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportsPeriodRange } from "../period";

/**
 * COUNT(Client) created in [range.start, range.end). `Client.organizationId`
 * is technically nullable (legacy pre-multi-tenant schema pattern — see
 * prisma/schema.prisma's own header comment on Client/Project/Task) —
 * filtering by an exact `organizationId` value, as this query already
 * does, naturally excludes any null-organizationId row (it can never
 * equal a real UUID), so a legacy row can never leak into this count
 * and can never leak cross-tenant either. This is the same convention
 * every existing Dashboard/Analytics Client query already relies on —
 * not a new assumption introduced here.
 */
export async function getNewClientsCount(organizationId: string, range: ReportsPeriodRange): Promise<number> {
  return prisma.client.count({
    where: { organizationId, createdAt: { gte: range.start, lt: range.end } },
  });
}
