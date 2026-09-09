import "server-only";
import type { CustomFieldEntityType } from "@/generated/prisma/enums";
import type { PrismaClientOrTx } from "./types";
import { prisma } from "@/lib/prisma";

/**
 * Section L — the one place that substitutes for a literal foreign key
 * from CustomFieldValue.entityId to Client/Lead/Project (see
 * CustomFieldValue's own schema comment for why no such FK exists). Every
 * value mutation in values.ts calls this before writing anything: never
 * trusts a caller-provided (entityType, entityId) pair on its own,
 * always re-verifies the target row actually exists in `organizationId`
 * AND that `entityType` genuinely matches which table it lives in. A
 * foreign-org id and a nonexistent id are deliberately indistinguishable
 * here — both simply return false (Section K).
 *
 * Selects only `id` — never fetches more of the target row than needed
 * to prove ownership (Section L's own explicit instruction).
 */
export async function assertCustomFieldEntityOwnership(
  {
    organizationId,
    entityType,
    entityId,
  }: {
    organizationId: string;
    entityType: CustomFieldEntityType;
    entityId: string;
  },
  client: PrismaClientOrTx = prisma,
): Promise<boolean> {
  switch (entityType) {
    case "CLIENT": {
      const client_ = await client.client.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
      return client_ !== null;
    }
    case "LEAD": {
      const lead = await client.lead.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
      return lead !== null;
    }
    case "PROJECT": {
      const project = await client.project.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
      return project !== null;
    }
    default: {
      // Exhaustiveness guard — CustomFieldEntityType only ever has the
      // three members above (Section C: V1 supports exactly CLIENT/LEAD/
      // PROJECT). If a future phase adds a fourth enum member without
      // updating this function, this throws loudly instead of silently
      // treating an unrecognized entityType as owned.
      const exhaustiveCheck: never = entityType;
      throw new Error(`assertCustomFieldEntityOwnership: unhandled entityType ${String(exhaustiveCheck)}`);
    }
  }
}
