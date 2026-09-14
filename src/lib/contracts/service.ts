import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { Contract } from "@/generated/prisma/client";
import { createActivity } from "@/lib/activity/create-activity";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import type { ContractActor } from "./authorization";
import { resolveContractTarget } from "./target";
import { resolveContractSignatory } from "./signatory";
import {
  parseContractInput,
  parseContractInternalNotes,
  type ContractWritableInput,
  type ContractFieldErrors,
  type ParsedContractValues,
} from "./validation";
import { mapContractWriteError } from "./write-conflict-mapper";
import { getContractForStaff, getContractForPortalClient, type ContractWithClient } from "./queries";
import {
  buildContractOrganizationSnapshotV1,
  buildContractClientSnapshotV1,
  buildContractSignatorySnapshotV1,
} from "./snapshot-types";
import type { PrismaClientOrTx } from "./types";

/**
 * Contracts Phase 1 — every lifecycle/CRUD mutation. Mirrors this app's
 * own established domain-module shape exactly (src/lib/quote-templates/
 * service.ts, src/lib/invoices/pdf/issue-invoice.ts): authorization
 * checked first; every read/write scoped by (id, organizationId) or, for
 * Portal, (id, clientId) together; a discriminated-union result instead
 * of a thrown error for every *expected* outcome; every real lifecycle
 * transition happens inside one prisma.$transaction, guarded by an
 * updateMany() whose `where` re-asserts the exact prior state, closing
 * the TOCTOU window between an earlier read and the eventual write (the
 * same discipline issueInvoice()'s own final transaction already
 * established for this codebase).
 *
 * Two structurally separate update paths exist on purpose:
 * updateContractDocument (DRAFT-only, immutability-guarded, the real
 * business-content fields) and updateContractInternalNotes (no status
 * guard at all, Staff-only commentary). Neither can be reached through
 * the other — see validation.ts's own header comment for why
 * `internalNotes` was deliberately kept out of ContractWritableInput.
 */

/** Thrown from inside a transaction when a guarded updateMany() matches zero rows — an ordinary optimistic-concurrency race (a concurrent send/accept/terminate/edit already changed the row's status out from under this call), never logged, always mapped to a controlled typed result by the caller. */
class ContractTransitionRaceError extends Error {}

const WITH_CLIENT = { client: { select: { id: true, name: true } } } as const;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateContractResult =
  | { ok: true; contract: ContractWithClient }
  | { ok: false; reason: "VALIDATION"; fieldErrors: ContractFieldErrors }
  | { ok: false; reason: "INVALID_TARGET" }
  | { ok: false; reason: "INVALID_SIGNATORY" }
  | { ok: false; reason: "CONTRACT_NUMBER_CONFLICT" };

/** Always creates a DRAFT — server controls status/timestamps/snapshots/createdByUserId; a caller can never create a pre-SENT/pre-ACCEPTED Contract (locked architecture §16). */
export async function createContract(
  organizationId: string,
  actor: ContractActor,
  input: ContractWritableInput,
): Promise<CreateContractResult> {
  const { values, fieldErrors } = parseContractInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }

  const targetResult = await resolveContractTarget(prisma, organizationId, {
    clientId: values.clientId,
    projectId: values.projectId,
  });
  if (!targetResult.ok) {
    return { ok: false, reason: "INVALID_TARGET" };
  }

  const signatoryResult = await resolveContractSignatory(prisma, organizationId, targetResult.target.clientId, values.signatoryContactId);
  if (!signatoryResult.ok) {
    return { ok: false, reason: "INVALID_SIGNATORY" };
  }

  try {
    const contract = await prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          organizationId,
          clientId: targetResult.target.clientId,
          projectId: targetResult.target.projectId,
          signatoryContactId: signatoryResult.contactId,
          contractNumber: values.contractNumber,
          title: values.title,
          body: values.body,
          issueDate: values.issueDate,
          effectiveDate: values.effectiveDate,
          expiresAt: values.expiresAt,
          createdByUserId: actor.id,
        },
        include: WITH_CLIENT,
      });

      await createActivity(tx, {
        organizationId,
        actorId: actor.id,
        entityType: "CONTRACT",
        entityId: created.id,
        action: "CREATED",
        metadata: { name: created.title },
      });

      return created;
    });

    return { ok: true, contract };
  } catch (err) {
    if (mapContractWriteError(err) === "CONTRACT_NUMBER_CONFLICT") {
      return { ok: false, reason: "CONTRACT_NUMBER_CONFLICT" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Update — document content (DRAFT only)
// ---------------------------------------------------------------------------

export type UpdateContractDocumentResult =
  | { ok: true; contract: ContractWithClient }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "NOT_EDITABLE" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: ContractFieldErrors }
  | { ok: false; reason: "INVALID_TARGET" }
  | { ok: false; reason: "INVALID_SIGNATORY" }
  | { ok: false; reason: "CONTRACT_NUMBER_CONFLICT" };

/**
 * The ONLY path that may mutate clientId/projectId/signatoryContactId/
 * contractNumber/title/body/issueDate/effectiveDate/expiresAt — every one
 * of them frozen the instant status leaves DRAFT (locked architecture
 * §8). Never touches internalNotes (see updateContractInternalNotes
 * below).
 */
export async function updateContractDocument(
  organizationId: string,
  contractId: string,
  actor: ContractActor,
  input: ContractWritableInput,
): Promise<UpdateContractDocumentResult> {
  const existing = await getContractForStaff(organizationId, contractId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.status !== "DRAFT") {
    return { ok: false, reason: "NOT_EDITABLE" };
  }

  const { values, fieldErrors } = parseContractInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }

  const targetResult = await resolveContractTarget(prisma, organizationId, {
    clientId: values.clientId,
    projectId: values.projectId,
  });
  if (!targetResult.ok) {
    return { ok: false, reason: "INVALID_TARGET" };
  }

  const signatoryResult = await resolveContractSignatory(prisma, organizationId, targetResult.target.clientId, values.signatoryContactId);
  if (!signatoryResult.ok) {
    return { ok: false, reason: "INVALID_SIGNATORY" };
  }

  try {
    const updated = await guardedTransition({
      contractId,
      organizationId,
      requiredStatus: "DRAFT",
      data: {
        clientId: targetResult.target.clientId,
        projectId: targetResult.target.projectId,
        signatoryContactId: signatoryResult.contactId,
        contractNumber: values.contractNumber,
        title: values.title,
        body: values.body,
        issueDate: values.issueDate,
        effectiveDate: values.effectiveDate,
        expiresAt: values.expiresAt,
      },
    });
    return { ok: true, contract: updated };
  } catch (err) {
    if (err instanceof ContractTransitionRaceError) {
      return { ok: false, reason: "NOT_EDITABLE" };
    }
    if (mapContractWriteError(err) === "CONTRACT_NUMBER_CONFLICT") {
      return { ok: false, reason: "CONTRACT_NUMBER_CONFLICT" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Update — internal notes (any status, structurally separate)
// ---------------------------------------------------------------------------

export type UpdateContractInternalNotesResult =
  | { ok: true; contract: ContractWithClient }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "VALIDATION"; error: string };

/**
 * Deliberately has NO isContractEditable()/status check at all —
 * internalNotes is Staff-only commentary, never part of the document
 * shown to or accepted by the Client, and stays editable in every status
 * including SENT/ACCEPTED/TERMINATED (locked architecture §8). This
 * function never touches any other column, so it can never be the path
 * by which document-content immutability is accidentally bypassed.
 */
export async function updateContractInternalNotes(
  organizationId: string,
  contractId: string,
  actor: ContractActor,
  internalNotes: unknown,
): Promise<UpdateContractInternalNotesResult> {
  const parsed = parseContractInternalNotes(internalNotes);
  if (!parsed.ok) {
    return { ok: false, reason: "VALIDATION", error: parsed.error };
  }

  const result = await prisma.contract.updateMany({
    where: { id: contractId, organizationId },
    data: { internalNotes: parsed.value },
  });
  if (result.count === 0) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const contract = await getContractForStaff(organizationId, contractId);
  if (!contract) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  return { ok: true, contract };
}

// ---------------------------------------------------------------------------
// Shared guarded-transition helper (document update / terminate share this
// exact "updateMany by prior status, throw on count 0, re-fetch" shape).
// send/accept build their own transactions inline below because each also
// needs to read/write other things (snapshots, a distinct actor field) in
// the very same transaction.
// ---------------------------------------------------------------------------

async function guardedTransition(args: {
  contractId: string;
  organizationId: string;
  requiredStatus: Contract["status"];
  // The Unchecked variant, not the plain ContractUpdateManyMutationInput
  // -- the plain one excludes clientId/projectId/signatoryContactId (raw
  // FK scalars only appear on the Unchecked input shape in this Prisma
  // major version), and updateContractDocument (this helper's only
  // caller) needs to write all three.
  data: Prisma.ContractUncheckedUpdateManyInput;
}): Promise<ContractWithClient> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.contract.updateMany({
      where: { id: args.contractId, organizationId: args.organizationId, status: args.requiredStatus },
      data: args.data,
    });
    if (result.count === 0) {
      throw new ContractTransitionRaceError();
    }
    return tx.contract.findFirstOrThrow({ where: { id: args.contractId }, include: WITH_CLIENT });
  });
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type SendContractResult =
  | { ok: true; contract: ContractWithClient }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "INVALID_TRANSITION" };

/**
 * DRAFT -> SENT. Builds and persists all three snapshots atomically with
 * the status change (locked architecture §9/§10: snapshots are written at
 * SEND, never rebuilt later). No real email, no Resend call — "send" here
 * means exactly what it means for Quote today (sendQuoteAction's own
 * precedent).
 *
 * A cheap pre-check via getContractForStaff fails fast for the common
 * cases (NOT_FOUND / already not DRAFT) before doing any real work; the
 * actual state change, however, is fully re-validated from a FRESH read
 * inside the transaction itself (never trusting the pre-check's own
 * now-possibly-stale snapshot of the row), exactly like issueInvoice()'s
 * own two-phase shape.
 */
export async function sendContract(organizationId: string, contractId: string, actor: ContractActor): Promise<SendContractResult> {
  const precheck = await getContractForStaff(organizationId, contractId);
  if (!precheck) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (precheck.status !== "DRAFT") {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }

  try {
    const contract = await prisma.$transaction(async (tx) => {
      const fresh = await tx.contract.findFirst({ where: { id: contractId, organizationId } });
      if (!fresh || fresh.status !== "DRAFT") {
        throw new ContractTransitionRaceError();
      }

      const [organization, profile, client, signatoryContact] = await Promise.all([
        tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
        tx.organizationProfile.findUnique({
          where: { organizationId },
          select: {
            legalName: true,
            country: true,
            taxId: true,
            supportEmail: true,
            phone: true,
            website: true,
            streetAddress: true,
            city: true,
            state: true,
            postalCode: true,
          },
        }),
        tx.client.findUniqueOrThrow({
          where: { id: fresh.clientId },
          select: {
            billingLegalName: true,
            company: true,
            name: true,
            email: true,
            taxId: true,
            streetAddress: true,
            city: true,
            state: true,
            postalCode: true,
            country: true,
          },
        }),
        fresh.signatoryContactId
          ? tx.clientContact.findUnique({
              where: { id: fresh.signatoryContactId },
              select: { name: true, email: true, role: true },
            })
          : Promise.resolve(null),
      ]);

      const organizationSnapshot = buildContractOrganizationSnapshotV1({ organizationName: organization.name, profile });
      const clientSnapshot = buildContractClientSnapshotV1(client);
      const signatorySnapshot = signatoryContact ? buildContractSignatorySnapshotV1(signatoryContact) : null;

      const now = new Date();
      const result = await tx.contract.updateMany({
        where: { id: contractId, organizationId, status: "DRAFT" },
        data: {
          status: "SENT",
          sentAt: now,
          organizationSnapshot: organizationSnapshot as unknown as Prisma.InputJsonValue,
          clientSnapshot: clientSnapshot as unknown as Prisma.InputJsonValue,
          // A Json? field requires the sentinel Prisma.JsonNull to store a
          // real database NULL -- a bare `null` is rejected at runtime by
          // Prisma's own input validation (see NullableJsonNullValueInput
          // in the generated client types). No signatory was selected on
          // this Contract, so signatorySnapshot is correctly persisted as
          // SQL NULL, never an empty/placeholder JSON object.
          signatorySnapshot: (signatorySnapshot ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
        },
      });
      if (result.count === 0) {
        throw new ContractTransitionRaceError();
      }

      await createActivity(tx, {
        organizationId,
        actorId: actor.id,
        entityType: "CONTRACT",
        entityId: contractId,
        action: "STATUS_CHANGED",
        metadata: { from: "DRAFT", to: "SENT", name: fresh.title },
      });

      return tx.contract.findFirstOrThrow({ where: { id: contractId }, include: WITH_CLIENT });
    });

    return { ok: true, contract };
  } catch (err) {
    if (err instanceof ContractTransitionRaceError) {
      return { ok: false, reason: "INVALID_TRANSITION" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Accept — Staff
// ---------------------------------------------------------------------------

export type AcceptContractByStaffResult =
  | { ok: true; contract: ContractWithClient }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "INVALID_TRANSITION" };

/**
 * SENT -> ACCEPTED, recorded by an authenticated Staff Membership
 * (OWNER/ADMIN/MEMBER — no privileged gate, see authorization.ts).
 * acceptedByUserId is set, acceptedByPortalUserId stays null — exactly
 * one actor source is ever populated (locked architecture §4). An
 * archived Contract cannot be Staff-accepted either, symmetric with the
 * Portal rule below.
 */
export async function acceptContractByStaff(
  organizationId: string,
  contractId: string,
  actor: ContractActor,
): Promise<AcceptContractByStaffResult> {
  const existing = await getContractForStaff(organizationId, contractId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.status !== "SENT" || existing.archivedAt !== null) {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }

  try {
    const contract = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await tx.contract.updateMany({
        where: { id: contractId, organizationId, status: "SENT", archivedAt: null },
        data: { status: "ACCEPTED", acceptedAt: now, acceptedByUserId: actor.id, acceptedByPortalUserId: null },
      });
      if (result.count === 0) {
        throw new ContractTransitionRaceError();
      }

      await createActivity(tx, {
        organizationId,
        actorId: actor.id,
        entityType: "CONTRACT",
        entityId: contractId,
        action: "STATUS_CHANGED",
        metadata: { from: "SENT", to: "ACCEPTED", name: existing.title, actor: "staff" },
      });

      return tx.contract.findFirstOrThrow({ where: { id: contractId }, include: WITH_CLIENT });
    });

    return { ok: true, contract };
  } catch (err) {
    if (err instanceof ContractTransitionRaceError) {
      return { ok: false, reason: "INVALID_TRANSITION" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Accept — Portal
// ---------------------------------------------------------------------------

export type AcceptContractByPortalResult =
  | { ok: true; contract: Contract }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "INVALID_TRANSITION" };

/**
 * SENT -> ACCEPTED, recorded by a verified PortalUser. Self-resolves its
 * own identity via getCurrentPortalUser() — NEVER accepts a
 * caller-supplied organizationId/clientId/portalUserId (locked
 * architecture §5: "do not create a generic action that accepts
 * caller-supplied organization/client/user IDs without verification").
 * Phase 1 has no Portal UI; this exists purely as a ready, safe domain
 * primitive for a later phase to call.
 *
 * getContractForPortalClient scopes strictly by the resolved
 * `clientId` — a foreign Contract (belonging to a different Client)
 * resolves to the identical NOT_FOUND a nonexistent one would, never a
 * distinguishable response.
 */
export async function acceptContractByPortal(contractId: string): Promise<AcceptContractByPortalResult> {
  const { portalUser, clientId, organizationId } = await getCurrentPortalUser();

  const existing = await getContractForPortalClient(clientId, contractId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.status !== "SENT" || existing.archivedAt !== null) {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }

  try {
    const contract = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await tx.contract.updateMany({
        where: { id: contractId, clientId, status: "SENT", archivedAt: null },
        data: { status: "ACCEPTED", acceptedAt: now, acceptedByPortalUserId: portalUser.id, acceptedByUserId: null },
      });
      if (result.count === 0) {
        throw new ContractTransitionRaceError();
      }

      // Portal identity has no User row of its own -- actorId is the
      // Staff/User audit-trail column (Activity.actorId), so it is null
      // here, matching every other Portal-originated Activity write in
      // this app; the Portal actor is recorded in metadata instead, same
      // as acceptContractByStaff's own "actor: staff" convention above.
      await createActivity(tx, {
        organizationId,
        actorId: null,
        entityType: "CONTRACT",
        entityId: contractId,
        action: "STATUS_CHANGED",
        metadata: { from: "SENT", to: "ACCEPTED", name: existing.title, actor: "portal" },
      });

      return tx.contract.findFirstOrThrow({ where: { id: contractId } });
    });

    return { ok: true, contract };
  } catch (err) {
    if (err instanceof ContractTransitionRaceError) {
      return { ok: false, reason: "INVALID_TRANSITION" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Terminate
// ---------------------------------------------------------------------------

export type TerminateContractResult =
  | { ok: true; contract: ContractWithClient }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "INVALID_TRANSITION" };

/**
 * ACCEPTED -> TERMINATED only (locked architecture §13). Terminal — no
 * "un-terminate" in this phase. Snapshots are never touched/cleared.
 */
export async function terminateContract(organizationId: string, contractId: string, actor: ContractActor): Promise<TerminateContractResult> {
  const existing = await getContractForStaff(organizationId, contractId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.status !== "ACCEPTED") {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }

  try {
    const contract = await prisma.$transaction(async (tx) => {
      const result = await tx.contract.updateMany({
        where: { id: contractId, organizationId, status: "ACCEPTED" },
        data: { status: "TERMINATED", terminatedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ContractTransitionRaceError();
      }

      await createActivity(tx, {
        organizationId,
        actorId: actor.id,
        entityType: "CONTRACT",
        entityId: contractId,
        action: "STATUS_CHANGED",
        metadata: { from: "ACCEPTED", to: "TERMINATED", name: existing.title },
      });

      return tx.contract.findFirstOrThrow({ where: { id: contractId }, include: WITH_CLIENT });
    });

    return { ok: true, contract };
  } catch (err) {
    if (err instanceof ContractTransitionRaceError) {
      return { ok: false, reason: "INVALID_TRANSITION" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Archive / restore — soft, idempotent, orthogonal to status
// ---------------------------------------------------------------------------

export type ArchiveContractResult =
  | { ok: true; contract: ContractWithClient }
  | { ok: false; reason: "NOT_FOUND" };

export type RestoreContractResult = ArchiveContractResult;

/**
 * Sets archivedAt only — never touches status/sentAt/acceptedAt/
 * terminatedAt/any snapshot (locked architecture §14). Idempotent: a
 * redundant call on an already-archived Contract is a no-op success,
 * matching archiveQuoteTemplate/archiveTag's own exact convention. No
 * Activity row is written here, matching that same precedent (neither
 * Quote nor QuoteTemplate archive/restore writes one either) — archiving
 * is a visibility toggle, not a business event.
 */
export async function archiveContract(
  organizationId: string,
  contractId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ArchiveContractResult> {
  const existing = await getContractForStaff(organizationId, contractId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    return { ok: true, contract: existing };
  }

  const contract = await client.contract.update({
    where: { id: contractId },
    data: { archivedAt: new Date() },
    include: WITH_CLIENT,
  });
  return { ok: true, contract };
}

export async function restoreContract(
  organizationId: string,
  contractId: string,
  client: PrismaClientOrTx = prisma,
): Promise<RestoreContractResult> {
  const existing = await getContractForStaff(organizationId, contractId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    return { ok: true, contract: existing };
  }

  const contract = await client.contract.update({
    where: { id: contractId },
    data: { archivedAt: null },
    include: WITH_CLIENT,
  });
  return { ok: true, contract };
}

export type { ParsedContractValues };
