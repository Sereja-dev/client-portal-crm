"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserOrganization } from "@/lib/current-user";
import {
  updateClientRequestStatus,
  updateClientRequestPriority,
  assignClientRequest,
  linkClientRequestProject,
  archiveClientRequest,
  unarchiveClientRequest,
} from "@/lib/client-requests/staff";
import { addStaffClientRequestMessage } from "@/lib/client-requests/messages";
import { checkRateLimit, CLIENT_REQUEST_MESSAGE_LIMIT } from "@/lib/rate-limit";
import type { ClientRequestMessageFormState } from "@/types";

/**
 * Client Requests / Tickets Phase 2A — Staff Server Action layer. Every
 * action here resolves the authenticated staff member itself
 * (getCurrentUserOrganization()) and calls straight into the existing
 * Phase 1 domain functions (src/lib/client-requests/staff.ts) — no
 * cross-org check is duplicated here, and every mutator's own return
 * value (already a safe, generic discriminated union — REQUEST_NOT_FOUND/
 * INVALID_STATUS/INVALID_PRIORITY/INVALID_ASSIGNEE/INVALID_PROJECT, never
 * a raw Prisma error) is passed straight back to the client component
 * unwrapped, the same "Server Action returns the domain result directly"
 * convention src/app/(dashboard)/leads/actions.ts's own
 * assignLeadStatusDefinitionAction/archiveLeadAction already use.
 */

function revalidateRequestPaths(requestId: string) {
  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
}

export async function updateClientRequestStatusAction(requestId: string, status: string) {
  const { user, organizationId } = await getCurrentUserOrganization();
  const result = await updateClientRequestStatus(organizationId, requestId, status, { id: user.id, name: user.name });
  if (result.ok) revalidateRequestPaths(requestId);
  return result;
}

export async function updateClientRequestPriorityAction(requestId: string, priority: string) {
  const { user, organizationId } = await getCurrentUserOrganization();
  const result = await updateClientRequestPriority(organizationId, requestId, priority, { id: user.id, name: user.name });
  if (result.ok) revalidateRequestPaths(requestId);
  return result;
}

export async function assignClientRequestAction(requestId: string, assignedToId: string | null) {
  const { user, organizationId } = await getCurrentUserOrganization();
  const result = await assignClientRequest(organizationId, requestId, assignedToId, { id: user.id, name: user.name });
  if (result.ok) revalidateRequestPaths(requestId);
  return result;
}

export async function linkClientRequestProjectAction(requestId: string, projectId: string | null) {
  const { user, organizationId } = await getCurrentUserOrganization();
  const result = await linkClientRequestProject(organizationId, requestId, projectId, { id: user.id, name: user.name });
  if (result.ok) revalidateRequestPaths(requestId);
  return result;
}

export async function archiveClientRequestAction(requestId: string) {
  const { organizationId } = await getCurrentUserOrganization();
  const result = await archiveClientRequest(organizationId, requestId);
  if (result.ok) revalidateRequestPaths(requestId);
  return result;
}

export async function unarchiveClientRequestAction(requestId: string) {
  const { organizationId } = await getCurrentUserOrganization();
  const result = await unarchiveClientRequest(organizationId, requestId);
  if (result.ok) revalidateRequestPaths(requestId);
  return result;
}

export async function addStaffClientRequestMessageAction(
  requestId: string,
  _prevState: ClientRequestMessageFormState,
  formData: FormData,
): Promise<ClientRequestMessageFormState> {
  const { user, organizationId } = await getCurrentUserOrganization();

  const limitCheck = checkRateLimit(CLIENT_REQUEST_MESSAGE_LIMIT, user.id);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const result = await addStaffClientRequestMessage(organizationId, requestId, user.id, formData.get("body"));

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: result.error === "empty" ? "Message can't be empty." : "Message is too long." };
    }
    return { error: "This request is not available." };
  }

  revalidatePath(`/requests/${requestId}`);
  return { error: null };
}
