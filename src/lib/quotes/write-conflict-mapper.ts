import "server-only";
import { Prisma } from "@/generated/prisma/client";

export type QuoteWriteConflict = "QUOTE_NUMBER_CONFLICT" | "UNRECOGNIZED";

type DriverAdapterMeta = {
  driverAdapterError?: {
    cause?: { constraint?: { fields?: unknown } };
  };
};

function hasExactFields(fields: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(fields) &&
    fields.length === expected.length &&
    expected.every((field, index) => fields[index] === field)
  );
}

/**
 * Quotes / Estimates Phase 2 — mirrors
 * src/lib/invoices/write-conflict-mapper.ts's own mapInvoiceWriteError
 * exactly (same P2002 signal shape: `error.meta.driverAdapterError.cause
 * .constraint.fields`, an ordered array of quoted column names — never
 * `error.meta.target`, which this project's Prisma/driver-adapter stack
 * does not populate). Both Quote writers (create, update) write
 * QuoteItem rows inside the same transaction, which carries its own
 * reachable `@@unique([quoteId, position])` constraint — any P2002 that
 * isn't positively identified as the Quote-number conflict must fail
 * closed as UNRECOGNIZED rather than being mislabeled.
 */
export function mapQuoteWriteError(error: unknown): QuoteWriteConflict {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return "UNRECOGNIZED";
  }

  // Empirically verified (a real duplicate-number create against this
  // project's actual Prisma/driver-adapter stack, not assumed from
  // Invoice's own precedent): Postgres only quotes an identifier in this
  // constraint-fields array when it contains uppercase letters —
  // `"organizationId"` (camelCase) is quoted, but `number` (already
  // all-lowercase) is not. Invoice's own equivalent check happens to have
  // both fields quoted only because `invoiceNumber` is itself camelCase;
  // that is a coincidence of Invoice's own column name, not a rule this
  // module can inherit unchecked.
  const fields = (error.meta as DriverAdapterMeta | undefined)?.driverAdapterError?.cause?.constraint?.fields;
  if (hasExactFields(fields, ['"organizationId"', "number"])) {
    return "QUOTE_NUMBER_CONFLICT";
  }

  return "UNRECOGNIZED";
}
