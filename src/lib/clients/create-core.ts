import "server-only";
import type { Prisma, Client } from "@/generated/prisma/client";
import { assertCanCreateClient } from "@/lib/billing/enforcement";
import { getDefaultStatusDefinition } from "@/lib/custom-statuses/resolution";
import { resolveStatusForSave } from "@/lib/custom-statuses/entity-form";
import { createActivity } from "@/lib/activity/create-activity";
import { buildClientActivityMetadata } from "@/lib/activity/client-metadata";
import { createClientContact, resolveFallbackContactName } from "@/lib/clients/contacts";
import type { ParsedClientBaseInput, ClientStatusValue } from "@/lib/validation/client";

/**
 * CSV Import Phase 2 — the domain refactor the approved architecture
 * calls for ("Do not call redirecting Client Server Actions in a loop.
 * Factor the existing create logic narrowly so manual interactive
 * create still behaves exactly as before; import can reuse the same
 * invariant-preserving create core.").
 *
 * `createClientAction` (interactive) and the import execute step both
 * call this one function from inside their own already-open
 * transaction — every invariant that matters (entitlement check, status
 * resolution, the Client row itself, primary ClientContact
 * auto-creation) runs identically either way. The only thing that
 * differs by `context` is Activity creation, which is the explicit,
 * named suppression mechanism for import's own "no per-row CREATED
 * Activity, no Workflow Automation dispatch" requirement: import's own
 * `activity` result is always `null`, so its own caller's post-commit
 * `if (activity) dispatchWorkflowAutomations(activity)` (the same
 * pattern createClientAction itself already uses) naturally never
 * fires — dispatch is a consequence of Activity being null, not a
 * second, separately-bypassable flag.
 */
export type ClientCreationContext = "interactive" | "import";

export class ClientStatusResolutionError extends Error {
  constructor(readonly reason: "NOT_FOUND" | "ARCHIVED") {
    super(`Client status resolution rejected: ${reason}`);
  }
}

export type CreateClientCoreParams = {
  organizationId: string;
  userId: string;
  actorName: string;
  context: ClientCreationContext;
  input: ParsedClientBaseInput;
  /**
   * Only meaningful for context "interactive" — the ClientForm's own
   * submitted target, re-verified here exactly as createClientAction
   * always has (never trusted merely because a request included it).
   * Import (context "import") must never supply this: Phase 2's own
   * locked scope explicitly excludes Status from CSV import, so import
   * always resolves to the organization's current default status
   * instead (see this function's own body) — the same "existing
   * default/current create semantics" the approved architecture
   * requires, safely derived rather than invented.
   */
  requestedStatusDefinitionId?: string;
};

export type CreateClientCoreResult = {
  client: Client;
  /** Non-null only for context "interactive" — see this module's own doc comment for why that alone is what suppresses Workflow Automation dispatch too. */
  activity: Awaited<ReturnType<typeof createActivity>> | null;
};

/**
 * Must be called from inside an already-open transaction (`tx`) — every
 * write here (Client row, ClientContact, Activity) is one atomic unit,
 * identical to createClientAction's own pre-existing transaction shape.
 */
export async function createClientCore(
  tx: Prisma.TransactionClient,
  params: CreateClientCoreParams,
): Promise<CreateClientCoreResult> {
  // Billing & Subscriptions Stage 2 — re-checked from inside this same
  // transaction for every single call, interactive or import: an import
  // run creating many Clients in sequence must never be able to blow
  // past an organization's own entitlement limit just because the
  // limit was still satisfied when the run started.
  await assertCanCreateClient(params.organizationId, tx);

  let statusResult: { definitionId: string; isSystem: boolean; key: string };
  if (params.context === "interactive") {
    const resolved = await resolveStatusForSave(
      params.organizationId,
      "CLIENT",
      params.requestedStatusDefinitionId ?? "",
      null,
      tx,
    );
    if (!resolved.ok) {
      throw new ClientStatusResolutionError(resolved.reason);
    }
    statusResult = resolved;
  } else {
    // CSV Import Phase 2's own locked scope: "For Phase 2, use the
    // existing default/current create semantics... do not import
    // arbitrary Client status from CSV." The organization's own current
    // default CLIENT status definition (normally the system "lead"
    // status, but Settings can in principle change which definition is
    // default) is exactly that existing default semantics, safely
    // derived rather than invented.
    const defaultDefinition = await getDefaultStatusDefinition(params.organizationId, "CLIENT", tx);
    statusResult = defaultDefinition
      ? { definitionId: defaultDefinition.id, isSystem: defaultDefinition.isSystem, key: defaultDefinition.key }
      : { definitionId: undefined as unknown as string, isSystem: true, key: "lead" };
  }

  // Section H's own documented compatibility rule (see createClientAction's
  // own identical comment): a SYSTEM target writes its own matching
  // legacy enum value; a CUSTOM target falls back to the same "LEAD"
  // legacy value parseClientForm's own field parser has always defaulted
  // to.
  const legacyStatus: ClientStatusValue = statusResult.isSystem
    ? (statusResult.key.toUpperCase() as ClientStatusValue)
    : "LEAD";

  const client = await tx.client.create({
    data: {
      name: params.input.name,
      company: params.input.company,
      email: params.input.email,
      phone: params.input.phone,
      notes: params.input.notes,
      billingLegalName: params.input.billingLegalName,
      taxId: params.input.taxId,
      streetAddress: params.input.streetAddress,
      city: params.input.city,
      state: params.input.state,
      postalCode: params.input.postalCode,
      country: params.input.country,
      status: legacyStatus,
      statusDefinitionId: statusResult.definitionId,
      userId: params.userId,
      organizationId: params.organizationId,
    },
  });

  // Multiple Contacts Phase 1 — identical to createClientAction's own
  // pre-existing behavior: a Client created with contact-capable fields
  // (email and/or phone) gets one primary ClientContact in the same
  // transaction. This invariant is preserved for import too — the
  // architecture's own explicit requirement ("Client primary
  // ClientContact auto-creation remains intact").
  if (params.input.email || params.input.phone) {
    const contactResult = await createClientContact(
      params.organizationId,
      client.id,
      {
        name: resolveFallbackContactName(params.input.email),
        email: params.input.email,
        phone: params.input.phone,
        isPrimary: true,
      },
      tx,
    );
    if (!contactResult.ok) {
      throw new Error(`Unexpected ClientContact creation failure: ${contactResult.reason}`);
    }
  }

  let activity: Awaited<ReturnType<typeof createActivity>> | null = null;
  if (params.context === "interactive") {
    activity = await createActivity(tx, {
      organizationId: params.organizationId,
      actorId: params.userId,
      entityType: "CLIENT",
      entityId: client.id,
      action: "CREATED",
      metadata: buildClientActivityMetadata(client, params.actorName),
    });
  }
  // context === "import": no Activity row is written at all — this is
  // the explicit, named suppression this module's own doc comment
  // describes, not a raw createMany bypass of any invariant above (the
  // Client row and its primary ClientContact are still created through
  // the exact same tx.client.create/createClientContact calls either
  // way).

  return { client, activity };
}
