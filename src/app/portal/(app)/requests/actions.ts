"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { createPortalClientRequest } from "@/lib/client-requests/portal";
import { addPortalClientRequestMessage } from "@/lib/client-requests/messages";
import { checkRateLimit, CLIENT_REQUEST_CREATE_LIMIT, CLIENT_REQUEST_MESSAGE_LIMIT } from "@/lib/rate-limit";
import { withToast } from "@/lib/toast-url";
import type { ClientRequestCreateFormState, ClientRequestMessageFormState } from "@/types";

/**
 * Client Requests / Tickets Phase 2A — Portal Server Action layer. Every
 * action here resolves the authenticated Portal identity itself
 * (getCurrentPortalUser()) and calls straight into the existing Phase 1
 * domain functions — organizationId/clientId/portalUserId are never
 * read from FormData, matching this app's existing Client-management
 * permission model exactly (see e.g. src/app/portal/(app)/quotes/actions.ts's
 * own identical shape). No cross-org/cross-client check is duplicated
 * here — createPortalClientRequest/addPortalClientRequestMessage already
 * enforce all of it themselves; this layer's only job is resolving auth
 * context, validating/shaping input, and turning the domain result into
 * a safe, generic {error} response.
 */

export async function createPortalClientRequestAction(
  _prevState: ClientRequestCreateFormState,
  formData: FormData,
): Promise<ClientRequestCreateFormState> {
  const { organizationId, clientId, portalUser } = await getCurrentPortalUser("/portal/requests");

  const limitCheck = checkRateLimit(CLIENT_REQUEST_CREATE_LIMIT, portalUser.id);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const result = await createPortalClientRequest(
    { organizationId, clientId, portalUserId: portalUser.id, portalUserName: portalUser.name },
    {
      title: formData.get("title"),
      description: formData.get("description"),
      priority: formData.get("priority"),
      projectId: formData.get("projectId"),
    },
  );

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: null, fieldErrors: result.fieldErrors };
    }
    // INVALID_PROJECT — the selector itself only ever lists this Client's
    // own Projects, so this only happens against a hand-crafted request;
    // never a raw Prisma/internal error string either way.
    return { error: "Select a valid project." };
  }

  revalidatePath("/portal/requests");
  redirect(withToast(`/portal/requests/${result.request.id}`, "Request submitted"));
}

export async function addPortalClientRequestMessageAction(
  requestId: string,
  _prevState: ClientRequestMessageFormState,
  formData: FormData,
): Promise<ClientRequestMessageFormState> {
  const { clientId, portalUser } = await getCurrentPortalUser(`/portal/requests/${requestId}`);

  const limitCheck = checkRateLimit(CLIENT_REQUEST_MESSAGE_LIMIT, portalUser.id);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const result = await addPortalClientRequestMessage(clientId, requestId, portalUser.id, formData.get("body"));

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: result.error === "empty" ? "Message can't be empty." : `Message is too long.` };
    }
    // REQUEST_NOT_FOUND (including archived — see addPortalClientRequestMessage's
    // own Phase 2A comment) / INVALID_AUTHOR — never a distinguishable
    // reason, never a raw internal error.
    return { error: "This request is not available." };
  }

  revalidatePath(`/portal/requests/${requestId}`);
  return { error: null };
}
