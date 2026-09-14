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

/** Thrown from inside a transaction when a guarded updateMany() matches zero rows — an ordinary optimistic-concurrency race (a concurrent send/accept/terminate/edit already changed the row's status, archivedAt, or updatedAt version out from under this call), never logged, always mapped to a controlled typed result by the caller. */
class ContractTransitionRaceError extends Error {}

/** Thrown from inside sendContract's transaction when the freshly-read signatoryContactId is no longer valid (foreign/nonexistent/archived) at SEND time — see sendContract's own doc comment for the locked SEND-time signatory revalidation rule. */
class ContractSignatoryInvalidError extends Error {}

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
 *
 * Archived DRAFTs are also NOT_EDITABLE (Contracts Hardening §4): archive
 * is a visibility/organization toggle for every OTHER lifecycle state,
 * but a DRAFT's own document content is still actively being authored,
 * so hiding it from the working list while silently leaving it open to
 * edits would be a confusing, unintended combination. A caller must
 * restoreContract() first. This does not apply to internalNotes (see
 * updateContractInternalNotes below, which stays editable in every
 * archive state as Staff-only operational metadata).
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
  if (existing.status !== "DRAFT" || existing.archivedAt !== null) {
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
// Shared guarded-transition helper. Currently used only by
// updateContractDocument (its "updateMany by prior status/archivedAt,
// throw on count 0, re-fetch" shape) — terminate/send/accept build their
// own transactions inline below because each also needs to read/write
// other things (snapshots, a distinct actor field, a fresh-version
// optimistic guard) in the very same transaction.
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
      // archivedAt: null -- an archived DRAFT is not document-editable
      // (Contracts Hardening §4); re-checked here, not just by the
      // caller's own pre-check, to close the same class of TOCTOU gap
      // sendContract's own fix below closes.
      where: { id: args.contractId, organizationId: args.organizationId, status: args.requiredStatus, archivedAt: null },
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
  | { ok: false; reason: "INVALID_TRANSITION" }
  | { ok: false; reason: "INVALID_SIGNATORY" };

/**
 * DRAFT -> SENT. Builds and persists all three snapshots atomically with
 * the status change (locked architecture §9/§10: snapshots are written at
 * SEND, never rebuilt later). No real email, no Resend call — "send" here
 * means exactly what it means for Quote today (sendQuoteAction's own
 * precedent).
 *
 * A cheap pre-check via getContractForStaff fails fast for the common
 * cases (NOT_FOUND / already not DRAFT/archived) before doing any real
 * work; the actual state change is fully re-validated from a FRESH read
 * inside the transaction itself (never trusting the pre-check's own
 * now-possibly-stale snapshot of the row).
 *
 * Contracts Hardening §1/§2 (closes a real pre-push-review-found TOCTOU
 * gap): the fresh read's own `updatedAt` is captured as an optimistic-
 * concurrency version token and threaded into the FINAL guarded update's
 * own WHERE clause below, exactly mirroring issueInvoice()'s own already-
 * proven `updatedAt: expectedDate` pattern
 * (src/lib/invoices/pdf/issue-invoice.ts). Without this token, a
 * concurrent updateContractDocument() landing between the fresh read
 * (used to build the snapshots) and this function's own final write could
 * change clientId/projectId/signatoryContactId/title/body/dates while
 * leaving `status` untouched (still DRAFT) — the OLD guard (id/org/status
 * only) would then still match and commit a snapshot that no longer
 * matches the Contract's own final document. Because Prisma's `@updatedAt`
 * bumps on every write to this row, `updatedAt: freshUpdatedAt` in the
 * final guard detects ANY such concurrent mutation (not just a clientId/
 * signatoryContactId change specifically) and fails the send safely
 * (INVALID_TRANSITION) instead of committing a mismatched snapshot.
 * `archivedAt: null` is re-checked in both the pre-check and the fresh
 * read/final guard — an archived Contract cannot be sent (Contracts
 * Hardening §4).
 *
 * Also revalidates the signatory at SEND time (Contracts Hardening §3):
 * if `signatoryContactId` is set but the contact is no longer a valid,
 * active (non-archived) member of this Contract's own Client — including
 * having been archived sometime between DRAFT selection and this SEND —
 * the send is refused with INVALID_SIGNATORY rather than silently
 * snapshotting an archived contact or silently clearing the field. This
 * only gates SEND readiness; an already-SENT Contract's own historical
 * signatorySnapshot remains valid forever regardless of what happens to
 * the live ClientContact row afterward (see snapshot immutability tests).
 */
export async function sendContract(organizationId: string, contractId: string, actor: ContractActor): Promise<SendContractResult> {
  const precheck = await getContractForStaff(organizationId, contractId);
  if (!precheck) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (precheck.status !== "DRAFT" || precheck.archivedAt !== null) {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }

  try {
    const contract = await prisma.$transaction(async (tx) => {
      const fresh = await tx.contract.findFirst({ where: { id: contractId, organizationId } });
      if (!fresh || fresh.status !== "DRAFT" || fresh.archivedAt !== null) {
        throw new ContractTransitionRaceError();
      }
      // Captured immediately after the fresh read, before any further
      // work -- the exact "version" this SEND is allowed to commit. See
      // this function's own doc comment above.
      const freshUpdatedAt = fresh.updatedAt;

      // SEND-time signatory revalidation (Contracts Hardening §3) --
      // reuses the exact same tenant/Client/archived-state check a new
      // DRAFT selection already goes through (resolveContractSignatory),
      // run here again against the FRESH signatoryContactId so a contact
      // archived after DRAFT selection but before SEND blocks the send
      // rather than being silently snapshotted or silently dropped.
      const signatoryResult = await resolveContractSignatory(tx, organizationId, fresh.clientId, fresh.signatoryContactId);
      if (!signatoryResult.ok) {
        throw new ContractSignatoryInvalidError();
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
        // id/organizationId/status/archivedAt re-assert the transition is
        // still legal; updatedAt: freshUpdatedAt is the optimistic-
        // concurrency token that closes the TOCTOU gap -- if ANY write
        // (a document edit, an archive, anything) touched this row since
        // `fresh` was read above, updatedAt will have moved and this
        // predicate will match zero rows, exactly like issueInvoice()'s
        // own `updatedAt: expectedDate` guard.
        where: { id: contractId, organizationId, status: "DRAFT", archivedAt: null, updatedAt: freshUpdatedAt },
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
    if (err instanceof ContractSignatoryInvalidError) {
      return { ok: false, reason: "INVALID_SIGNATORY" };
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
 *
 * Terminology (Contracts Hardening §12, locked): this records that a
 * Staff member RECORDED the Contract as accepted — it does NOT assert
 * that the intended signatory (signatoryContactId / signatorySnapshot)
 * personally accepted anything. signatorySnapshot is intended-recipient/
 * addressee context captured at SEND, never proof of personal acceptance
 * — that distinction lives entirely in which actor column gets populated
 * here (acceptedByUserId, a Staff Membership) versus in
 * acceptContractByPortal below (acceptedByPortalUserId, an authenticated
 * Client Portal identity). A future UI must not render this as "signed
 * by <signatory name>" — see metadata's own `actor: "staff"` marker.
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
 *
 * Multi-PortalUser semantics (Contracts Hardening §13, locked V1 scope):
 * a Client may have more than one PortalUser (PortalUser.clientId is a
 * plain many-to-one FK, not unique), and this Contract model has no
 * "sent to this specific PortalUser" targeting concept at all (only
 * `signatoryContactId`, a completely separate ClientContact reference) —
 * so ANY authenticated PortalUser belonging to this Contract's own
 * Client may record its acceptance, not only one matching the intended
 * signatory. This is a documented V1 limitation, not a defect; no
 * recipient-specific acceptance restriction is in scope for this phase.
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
 *
 * Deliberately has NO archivedAt check (Contracts Hardening §4, locked):
 * archive is a visibility/organization toggle, never a legal-lifecycle
 * freeze, so an archived ACCEPTED Contract MAY still be terminated --
 * unlike send/accept, which archive correctly blocks (a Contract must
 * still be visible/active to be newly offered or newly accepted, but
 * ending an already-accepted business relationship is not something
 * hiding the record from a list should be able to prevent).
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
