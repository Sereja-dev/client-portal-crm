import "server-only";
import { Prisma } from "@/generated/prisma/client";

export type ContractWriteConflict = "CONTRACT_NUMBER_CONFLICT" | "UNRECOGNIZED";

type DriverAdapterMeta = {
  driverAdapterError?: {
    cause?: { constraint?: { fields?: unknown } };
  };
};

function hasExactFields(fields: unknown, expected: readonly string[]): boolean {
  return Array.isArray(fields) && fields.length === expected.length && expected.every((field, index) => fields[index] === field);
}

/**
 * Contracts Phase 1 — mirrors src/lib/quotes/write-conflict-mapper.ts's
 * own mapQuoteWriteError exactly (same P2002 signal shape:
 * `error.meta.driverAdapterError.cause.constraint.fields`, an ordered
 * array of quoted column names — never `error.meta.target`, which this
 * project's Prisma/driver-adapter stack does not populate).
 *
 * Both `organizationId` and `contractNumber` are camelCase identifiers
 * (contain an uppercase letter), so — per mapQuoteWriteError's own
 * empirically-verified rule for this exact Prisma/driver-adapter stack
 * ("Postgres only quotes an identifier in this constraint-fields array
 * when it contains uppercase letters") — both are quoted in the
 * constraint's own fields array, exactly like Invoice's own
 * `invoiceNumber` (unlike Quote's own all-lowercase `number`, which is
 * not). Any P2002 that isn't positively identified as the
 * organizationId+contractNumber conflict must fail closed as
 * UNRECOGNIZED rather than being mislabeled.
 */
export function mapContractWriteError(error: unknown): ContractWriteConflict {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return "UNRECOGNIZED";
  }

  const fields = (error.meta as DriverAdapterMeta | undefined)?.driverAdapterError?.cause?.constraint?.fields;
  if (hasExactFields(fields, ['"organizationId"', '"contractNumber"'])) {
    return "CONTRACT_NUMBER_CONFLICT";
  }

  return "UNRECOGNIZED";
}
