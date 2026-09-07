import "server-only";
import { Prisma } from "@/generated/prisma/client";

export type DeleteConflict = "HAS_DEPENDENT_INVOICES" | "UNRECOGNIZED";

type DriverAdapterMeta = {
  modelName?: unknown;
  driverAdapterError?: {
    cause?: { code?: unknown };
  };
};

/**
 * Post-Hardening Residual Code Audit (P2) — deleteClientAction/
 * deleteProjectAction previously let a blocked delete propagate as an
 * unhandled exception, surfacing only DeleteButton's own generic "Failed
 * to delete {itemName}." toast with no explanation. This maps the
 * specific, empirically verified error shape a Postgres RESTRICT
 * violation actually produces on this project's Prisma/driver-adapter
 * stack (confirmed directly against a real blocked delete before writing
 * this, the same discipline write-conflict-mapper.ts's own header comment
 * documents for its sibling P2002 case, never assumed from generic Prisma
 * documentation): `error.code` is `"P2039"` (not the "classic" P2003 this
 * stack does not actually throw), and `error.meta.driverAdapterError
 * .cause.code` carries the real underlying Postgres SQLSTATE, `"23001"`
 * (restrict_violation) — never the free-text constraint name, which this
 * function never inspects or parses.
 *
 * `expectedModelName` cross-checks `error.meta.modelName` (the model the
 * delete was attempted against) so a caller only ever classifies a
 * violation against the exact model it just tried to delete, never a
 * coincidentally-shaped error from something unrelated.
 *
 * Schema fact this classification relies on (verified against
 * prisma/schema.prisma, not assumed): `Invoice.clientId` and
 * `Invoice.projectId` are the ONLY `onDelete: Restrict` relations pointing
 * at Client/Project respectively — `Project.clientId` and `Task.projectId`
 * are both `onDelete: Cascade`. A positively-identified restrict violation
 * against exactly one of these two models can therefore only be caused by
 * an existing Invoice today, which is why this function's one real
 * outcome is named HAS_DEPENDENT_INVOICES rather than a more generic
 * "has dependents" — if a future schema change ever adds a second Restrict
 * relation on either model, this comment (and this function's own name)
 * would need revisiting, not silently stay accurate by accident.
 *
 * Fails closed to UNRECOGNIZED for anything not positively matched —
 * every unrelated failure (a different constraint, a connection error, a
 * bug) must keep propagating to the caller's own generic handling, never
 * be silently reclassified as "has dependent invoices."
 */
export function mapDeleteRestrictError(error: unknown, expectedModelName: "Client" | "Project"): DeleteConflict {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2039") {
    return "UNRECOGNIZED";
  }

  const meta = error.meta as DriverAdapterMeta | undefined;
  const isRestrictViolation = meta?.driverAdapterError?.cause?.code === "23001";
  const matchesModel = meta?.modelName === expectedModelName;

  if (isRestrictViolation && matchesModel) {
    return "HAS_DEPENDENT_INVOICES";
  }

  return "UNRECOGNIZED";
}
