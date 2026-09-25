import "server-only";
import { prisma } from "@/lib/prisma";

// Same "small local duplicated pattern" precedent this app's own
// isUuid() already establishes independently in several validation
// modules (src/lib/validation/{lead,time-entry,recurring-invoice}.ts) —
// used only to avoid ever handing a non-UUID string straight into a
// `@db.Uuid` column filter (Prisma throws a validation error for that,
// rather than safely matching zero rows).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Leads Pipeline V1 (Section 19-22) — resolves an optional `?clientId=`
 * query-string prefill safely, shared by exactly the three post-
 * conversion follow-up routes (/projects/new, /quotes/new,
 * /invoices/new) so this one tenant-scoped lookup can never drift
 * between them. Returns the Client only when it genuinely belongs to
 * the caller's own organization — never trusts the query string as
 * authorization, never leaks whether a foreign-org or nonexistent id
 * exists (an invalid id here is indistinguishable from an absent one:
 * both simply return null, and every calling page's own existing
 * behavior is otherwise completely unchanged).
 */
export async function resolveClientPrefill(
  organizationId: string,
  rawClientId: string,
): Promise<{ id: string; name: string } | null> {
  if (!UUID_PATTERN.test(rawClientId)) {
    return null;
  }
  return prisma.client.findFirst({
    where: { id: rawClientId, organizationId },
    select: { id: true, name: true },
  });
}
