import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Leads / Sales Pipeline Phase 2.2. Same shape as
 * src/lib/billing/usage.ts's own PrismaClientOrTx — duplicated locally
 * rather than imported cross-feature for one trivial type alias.
 */
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export type FindDuplicateOrganizationClientByEmailOptions = {
  organizationId: string;
  /** Raw, not-yet-normalized input — trimmed and case-folded here, consistent for every caller. */
  email: string | null | undefined;
  /** The Client currently being edited, if any — excluded so keeping your own unchanged email never self-conflicts. */
  excludeClientId?: string;
  /** Pass a transaction's own client for an atomic re-check immediately before the write it guards; defaults to the app singleton. */
  client?: PrismaClientOrTx;
};

/**
 * The one shared same-organization, case-insensitive Client email
 * duplicate check — createClientAction, updateClientAction, and
 * convertLeadToClientAction each had their own slightly different
 * version of this before Phase 2.2; now there's exactly one.
 *
 * Deliberately returns a plain boolean, never the matching Client's own
 * row/id: no caller here has a legitimate reason to know which existing
 * Client collided (createClientAction/updateClientAction only need to
 * block the write and show a field error; convertLeadToClientAction's
 * own architecture audit explicitly required never revealing the
 * existing Client's id in its result). Always organizationId-scoped —
 * structurally incapable of leaking whether a matching email exists in
 * a *different* organization, since that row is never part of the query
 * in the first place.
 *
 * A null/empty (post-trim) email always returns false without querying
 * — there is nothing to collide on, matching every one of this app's
 * existing "optional email" conventions (Client.email itself is
 * nullable, and multiple Clients with no email already coexist safely).
 */
export async function findDuplicateOrganizationClientByEmail({
  organizationId,
  email,
  excludeClientId,
  client = prisma,
}: FindDuplicateOrganizationClientByEmailOptions): Promise<boolean> {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return false;

  const existing = await client.client.findFirst({
    where: {
      organizationId,
      email: { equals: trimmed, mode: "insensitive" },
      ...(excludeClientId ? { id: { not: excludeClientId } } : {}),
    },
    select: { id: true },
  });

  return existing !== null;
}
