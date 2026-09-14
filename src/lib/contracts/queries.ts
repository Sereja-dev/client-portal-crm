import "server-only";
import { prisma } from "@/lib/prisma";
import type { Contract, ContractStatus } from "@/generated/prisma/client";
import { isUuid } from "@/lib/validation/lead";
import type { PrismaClientOrTx } from "./types";

/**
 * Contracts Phase 1 — read-side queries needed by a future Staff UI
 * (list/detail) and the Portal acceptance foundation (service.ts). No UI
 * exists yet; these are plain, org-scoped domain functions only.
 *
 * Every lookup by id first checks isUuid() and returns null immediately
 * for a malformed id — never lets a non-UUID string reach the database
 * layer, matching this codebase's universal "a foreign-org id is
 * indistinguishable from a nonexistent one" doctrine.
 */

export type ContractWithClient = Contract & {
  client: { id: string; name: string };
  // Contracts Phase 2 (Staff UI) — additive to Phase 1's own reviewed
  // shape: the list/detail UI needs the current Project name and the
  // current live signatory identity (not just the SENT snapshot) to
  // display "current relational Client/Project/signatory link" alongside
  // frozen sent-party data where relevant (locked architecture §19). Both
  // are optional relations already on Contract itself — this widens what
  // every existing service.ts caller of WITH_CLIENT returns, never a
  // second query or a new include shape.
  project: { id: string; name: string } | null;
  signatoryContact: { id: string; name: string; email: string | null; role: string | null; archivedAt: Date | null } | null;
};

// Exported so service.ts's own lifecycle mutations (create/update/send/
// accept/terminate/archive/restore) return this exact same enriched
// shape too, via one shared constant rather than two independently
// hand-maintained copies of the same include object.
export const WITH_CLIENT = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  signatoryContact: { select: { id: true, name: true, email: true, role: true, archivedAt: true } },
};

export type ListContractsOptions = {
  /** Defaults to excluding archived rows — same convention as listQuoteTemplates/listTags. */
  includeArchived?: boolean;
  status?: ContractStatus;
  clientId?: string;
  /** Matches contractNumber, title, or the target Client's own name — never `body` (see this phase's own architecture-lock report §23: no cheap existing pattern searches free-text document content). */
  search?: string;
};

/** Deterministic order: newest first, id as a stable tie-break (createdAt can collide at the same millisecond under concurrent creates; id never does). No pagination in V1 — matches Quote Templates' own identical scale reasoning. */
export async function listContracts(
  organizationId: string,
  options: ListContractsOptions = {},
  client: PrismaClientOrTx = prisma,
): Promise<ContractWithClient[]> {
  const search = options.search?.trim();
  return client.contract.findMany({
    where: {
      organizationId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
      ...(options.status ? { status: options.status } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(search
        ? {
            OR: [
              { contractNumber: { contains: search, mode: "insensitive" } },
              { title: { contains: search, mode: "insensitive" } },
              { client: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: WITH_CLIENT,
  });
}

/** For Staff management (view/edit/send/accept/terminate/archive/restore) — returned regardless of status/archived state, since a management UI must still be able to view a terminated or archived Contract. */
export async function getContractForStaff(
  organizationId: string,
  contractId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ContractWithClient | null> {
  if (!isUuid(contractId)) return null;
  return client.contract.findFirst({
    where: { id: contractId, organizationId },
    include: WITH_CLIENT,
  });
}

/**
 * For Portal acceptance only — scoped by the Contract's own `clientId`,
 * never by `organizationId` (a Portal identity has no "active
 * organization" concept at all — see getCurrentPortalUser()'s own doc
 * comment; its Client IS its tenant boundary). Returned regardless of
 * status so the caller (acceptContractByPortal in service.ts) can
 * produce its own specific, safe "not eligible" result rather than a
 * bare null collapsing every reason into one — but a foreign-Client
 * Contract still resolves to null here, exactly like a nonexistent one,
 * so a Portal identity can never even learn that a foreign Contract id
 * exists.
 */
export async function getContractForPortalClient(
  clientId: string,
  contractId: string,
  client: PrismaClientOrTx = prisma,
): Promise<Contract | null> {
  if (!isUuid(contractId)) return null;
  return client.contract.findFirst({ where: { id: contractId, clientId } });
}
