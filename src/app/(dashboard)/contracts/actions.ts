"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import {
  createContract,
  updateContractDocument,
  updateContractInternalNotes,
  sendContract,
  acceptContractByStaff,
  terminateContract,
  archiveContract,
  restoreContract,
  type CreateContractResult,
  type UpdateContractDocumentResult,
  type UpdateContractInternalNotesResult,
  type SendContractResult,
  type AcceptContractByStaffResult,
  type TerminateContractResult,
  type ArchiveContractResult,
  type RestoreContractResult,
} from "@/lib/contracts/service";
import type { ContractActor } from "@/lib/contracts/authorization";
import type { ContractWritableInput } from "@/lib/contracts/validation";

/**
 * Contracts Phase 2 (Staff UI) — the Server Action layer binding
 * src/lib/contracts/service.ts's own already-reviewed (Phase 1 +
 * hardening) domain functions to the Staff Contracts UI. Mirrors
 * src/app/(dashboard)/settings/templates/actions.ts's own
 * createQuoteTemplateAction shape exactly: every action here re-resolves
 * {user, organizationId, membership} itself via getCurrentMembership() —
 * never trusts a client-supplied organizationId, actor id, or role — and
 * hands off straight to the Phase 1 service function, which is the only
 * place any lifecycle/validation/authorization logic lives (locked
 * architecture §29: "Do not duplicate lifecycle logic in action files").
 * No role check exists here either — Contracts has no privileged gate
 * (canManageContracts always returns true for any authenticated
 * Membership role; see authorization.ts's own doc comment) — every one
 * of OWNER/ADMIN/MEMBER reaches the same service call.
 *
 * revalidatePath is only ever called on a successful outcome — matching
 * every Quote/QuoteTemplate lifecycle action's own identical discipline
 * — so a rejected mutation never invalidates a cache for a page that
 * didn't actually change.
 */

function actorFor(user: { id: string; name: string }, role: ContractActor["role"]): ContractActor {
  return { id: user.id, name: user.name, role };
}

export async function createContractAction(input: ContractWritableInput): Promise<CreateContractResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await createContract(organizationId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/contracts");
  }
  return result;
}

export async function updateContractDocumentAction(
  contractId: string,
  input: ContractWritableInput,
): Promise<UpdateContractDocumentResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await updateContractDocument(organizationId, contractId, actorFor(user, membership.role), input);
  if (result.ok) {
    revalidatePath("/contracts");
    revalidatePath(`/contracts/${contractId}`);
  }
  return result;
}

export async function updateContractInternalNotesAction(
  contractId: string,
  internalNotes: string,
): Promise<UpdateContractInternalNotesResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await updateContractInternalNotes(organizationId, contractId, actorFor(user, membership.role), internalNotes);
  if (result.ok) {
    revalidatePath(`/contracts/${contractId}`);
  }
  return result;
}

export async function sendContractAction(contractId: string): Promise<SendContractResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await sendContract(organizationId, contractId, actorFor(user, membership.role));
  if (result.ok) {
    revalidatePath("/contracts");
    revalidatePath(`/contracts/${contractId}`);
  }
  return result;
}

export async function acceptContractByStaffAction(contractId: string): Promise<AcceptContractByStaffResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await acceptContractByStaff(organizationId, contractId, actorFor(user, membership.role));
  if (result.ok) {
    revalidatePath("/contracts");
    revalidatePath(`/contracts/${contractId}`);
  }
  return result;
}

export async function terminateContractAction(contractId: string): Promise<TerminateContractResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await terminateContract(organizationId, contractId, actorFor(user, membership.role));
  if (result.ok) {
    revalidatePath("/contracts");
    revalidatePath(`/contracts/${contractId}`);
  }
  return result;
}

export async function archiveContractAction(contractId: string): Promise<ArchiveContractResult> {
  const { organizationId } = await getCurrentMembership();
  const result = await archiveContract(organizationId, contractId);
  if (result.ok) {
    revalidatePath("/contracts");
    revalidatePath(`/contracts/${contractId}`);
  }
  return result;
}

export async function restoreContractAction(contractId: string): Promise<RestoreContractResult> {
  const { organizationId } = await getCurrentMembership();
  const result = await restoreContract(organizationId, contractId);
  if (result.ok) {
    revalidatePath("/contracts");
    revalidatePath(`/contracts/${contractId}`);
  }
  return result;
}
